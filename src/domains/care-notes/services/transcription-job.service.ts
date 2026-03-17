import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';

import { LoggerService } from '../../../common/logger/logger.service';
import { Aes256Service } from '../../../common/security/encryption/aes-256.service';
import { AuditLogService } from '../../audit/services/audit-log.service';

import { TranscriptionJobRepository } from '../repositories/transcription-job.repository';
import { TranscriptionJob } from '../entities/transcription-job.entity';
import { RecordingsTranscript } from '../entities/recordings-transcript.entity';

import { AiNoteService } from './ai-note.service';
import { AiUsageReportingService, AiOperation, AiUsageStatus } from './ai-usage-reporting.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import {
  TranscriptionJobGateway,
  TranscriptionProgressEvent,
} from '../gateways/transcription-job.gateway';

import {
  AIProvider,
  TranscriptionSourceType,
  TranscriptionStatus,
  TranscriptionStep,
  TranscriptionMode,
  AuditEventType,
  AuditOutcome,
  NoteAuditActionType,
} from '../../../common/enums';

// =============================================================================
// Internal Interfaces
// =============================================================================

/**
 * Parameters for creating a background transcription job.
 */
interface CreateTranscriptionJobParams {
  doctorId: string;
  consultationId: string;
  audioFilePath: string;
  provider?: AIProvider;
  model?: string;
  temperature?: number;
  language?: string;
  context?: string;
  noteType?: string;
  templateId?: string;
  audioFileSizeBytes?: number;
  audioDurationSeconds?: number;
  patientName?: string;
}

/**
 * Parameters for creating a background image analysis job.
 */
interface CreateImageAnalysisJobParams {
  doctorId: string;
  consultationId: string;
  imageFilePath: string;
  provider?: AIProvider;
  model?: string;
  temperature?: number;
  language?: string;
  context?: string;
  noteType?: string;
  templateId?: string;
  imageFileSizeBytes?: number;
  patientName?: string;
}

/**
 * Query filters for listing transcriptions.
 */
interface TranscriptionFilters {
  status?: TranscriptionStatus;
  mode?: TranscriptionMode;
  consultationId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Transcription item DTO for list responses.
 * Uses typed columns directly — no JSON blob parsing.
 */
export interface TranscriptionItemDto {
  id: string;
  sourceType?: string;
  mode: TranscriptionMode;
  status: TranscriptionStatus;
  currentStep: TranscriptionStep;
  progressPercentage: number;
  progressMessage: string;
  consultationId: string;
  patientName?: string;
  transcriptId?: string;
  noteId?: string;
  noteType?: string;
  transcriptPreview?: string;
  isStructured?: boolean;
  resolvedProvider?: string;
  resolvedModel?: string;
  processingTimeMs?: number;
  audioFileSizeBytes?: number;
  audioDurationSeconds?: number;
  imageFilePath?: string;
  imageFileSizeBytes?: number;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  noteGeneratedAt?: Date;
  retryCount: number;
}

/**
 * Detailed status response for a single transcription.
 */
interface TranscriptionStatusDto {
  id: string;
  mode: TranscriptionMode;
  status: TranscriptionStatus;
  currentStep: TranscriptionStep;
  progressPercentage: number;
  progressMessage: string;
  rawTranscribedText?: string;
  transcriptPreview?: string;
  transcriptId?: string;
  consultationId: string;
  patientName?: string;
  provider?: string;
  model?: string;
  language?: string;
  noteType?: string;
  resolvedProvider?: string;
  resolvedModel?: string;
  processingTimeMs?: number;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  retryCount: number;
}

// =============================================================================
// Service Implementation
// =============================================================================

/**
 * TranscriptionJobService
 *
 * Manages BACKGROUND audio transcription jobs using a polling-based pipeline.
 * STANDARD (synchronous) jobs are created and tracked by AiNoteService directly.
 *
 * Implements OnModuleInit to start background processing on application startup.
 *
 * Pipeline stages (BACKGROUND mode):
 * 1. PENDING → PROCESSING: Job picked up by poller
 * 2. PROCESSING → TRANSCRIBING: Audio sent to AI provider
 * 3. TRANSCRIBING → STRUCTURING: Raw text structuring via AI
 * 4. STRUCTURING → SAVING: Persisting RecordingsTranscript entity
 * 5. SAVING → PENDING_NOTE_GENERATION: Complete, ready for note generation
 *
 * Features:
 * - Polling-based job queue (10-second interval, 5 items per batch)
 * - Multi-provider AI transcription with fallback (via AiNoteService)
 * - Retry logic with max 3 attempts
 * - Stuck process detection (30-minute timeout)
 * - Multi-tenant workspace isolation
 * - Audit logging for all operations
 *
 * Note: This service has a circular dependency with AiNoteService,
 * resolved via forwardRef.
 */
@Injectable()
export class TranscriptionJobService implements OnModuleInit, OnModuleDestroy {
  /** Processing interval in milliseconds (10 seconds) */
  private readonly PROCESS_INTERVAL = 10_000;

  /** Maximum items per polling cycle */
  private readonly BATCH_SIZE = 5;

  /** Maximum retry attempts before permanent failure */
  private readonly MAX_RETRIES = 3;

  /** Minutes before a processing job is considered stuck */
  private readonly STUCK_TIMEOUT_MINUTES = 30;

  /** Timeout for AI transcription calls in milliseconds (5 minutes) */
  private readonly AI_CALL_TIMEOUT_MS = 5 * 60 * 1000;

  /** Timeout for AI structuring calls in milliseconds (3 minutes) */
  private readonly AI_STRUCTURE_TIMEOUT_MS = 3 * 60 * 1000;

  /** Days to keep completed/failed jobs before cleanup */
  private readonly JOB_RETENTION_DAYS = 90;

  /** Cleanup interval in milliseconds (runs every 6 hours) */
  private readonly CLEANUP_INTERVAL = 6 * 60 * 60 * 1000;

  /** Lock to prevent concurrent polling cycles */
  private isProcessing = false;

  /** Interval handle for cleanup */
  private processingInterval: ReturnType<typeof setInterval>;

  /** Interval handle for job cleanup */
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(
    private readonly transcriptionRepo: TranscriptionJobRepository,
    @Inject(forwardRef(() => AiNoteService))
    private readonly aiNoteService: AiNoteService,
    private readonly gateway: TranscriptionJobGateway,
    private readonly auditLogService: AuditLogService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly aesService: Aes256Service,
    private readonly notificationsService: NotificationsService,
    private readonly aiUsageReportingService: AiUsageReportingService,
  ) {
    this.logger.setContext('TranscriptionJobService');
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  /**
   * Start background processing on module initialization.
   * Waits 1 second before first run, then polls every 10 seconds.
   */
  onModuleInit(): void {
    this.logger.log('TranscriptionJobService initialized, starting poller...');

    // Initial run after a short delay
    setTimeout(() => {
      this.processPendingTranscriptions().catch((err) => {
        this.logger.error(`Initial processing failed: ${err.message}`, err.stack);
      });
    }, 1000);

    // Set up recurring polling
    this.processingInterval = setInterval(() => {
      if (!this.isProcessing) {
        this.processPendingTranscriptions().catch((err) => {
          this.logger.error(`Polling cycle failed: ${err.message}`, err.stack);
        });
      }
    }, this.PROCESS_INTERVAL);

    // Set up recurring job cleanup (every 6 hours)
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldJobs().catch((err) => {
        this.logger.error(`Job cleanup failed: ${err.message}`, err.stack);
      });
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * Clean up intervals on module destruction to prevent memory leaks.
   */
  onModuleDestroy(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.logger.log('TranscriptionJobService destroyed, polling stopped');
  }

  // ===========================================================================
  // PUBLIC METHODS
  // ===========================================================================

  /**
   * Create a new BACKGROUND transcription job.
   *
   * Creates a TranscriptionJob record with mode=BACKGROUND, status=PENDING and
   * triggers immediate processing (100ms delay). Returns the process ID for
   * polling.
   *
   * @param params - Job parameters
   * @param workspaceId - Tenant workspace ID
   * @returns Process ID, status, and message
   */
  async createTranscriptionJob(
    params: CreateTranscriptionJobParams,
    workspaceId: string,
  ): Promise<{ mode: string; id: string; status: string; message: string }> {
    this.logger.log(
      `Creating background transcription: consultation=${params.consultationId}, doctor=${params.doctorId}`,
    );

    const transcription = this.transcriptionRepo.create({
      id: uuidv4(),
      workspaceId,
      doctorId: params.doctorId,
      consultationId: params.consultationId,
      audioFilePath: params.audioFilePath,
      mode: TranscriptionMode.BACKGROUND,
      status: TranscriptionStatus.PENDING,
      currentStep: TranscriptionStep.UPLOAD,
      provider: params.provider || AIProvider.OPENAI,
      model: params.model || '',
      temperature: params.temperature ?? 0.0,
      language: params.language || 'en',
      context: params.context || '',
      noteType: params.noteType || null,
      templateId: params.templateId || null,
      audioFileSizeBytes: params.audioFileSizeBytes || null,
      audioDurationSeconds: params.audioDurationSeconds || null,
      patientName: params.patientName || null,
      progressPercentage: 0,
      progressMessage: 'Audio file queued for processing',
      retryCount: 0,
    } as any) as unknown as TranscriptionJob;

    await this.transcriptionRepo.save(transcription);

    this.logger.log(
      `Background transcription created: ${transcription.id}, triggering immediate processing`,
    );

    // Trigger immediate processing
    setTimeout(() => {
      this.processPendingTranscriptions().catch((err) => {
        this.logger.error(
          `Immediate processing trigger failed: ${err.message}`,
          err.stack,
        );
      });
    }, 100);

    // Audit log
    await this.safeAuditLog(
      {
        userId: params.doctorId,
        action: 'createTranscriptionJob',
        eventType: AuditEventType.CREATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'TranscriptionJob',
        resourceId: transcription.id,
        metadata: {
          action: NoteAuditActionType.AI_GENERATE,
          consultationId: params.consultationId,
          provider: params.provider,
          mode: TranscriptionMode.BACKGROUND,
        },
      },
      workspaceId,
    );

    return {
      mode: 'BACKGROUND',
      id: transcription.id,
      status: TranscriptionStatus.PENDING,
      message: 'Audio file queued for background processing',
    };
  }

  /**
   * Create a background image analysis job.
   * Mirrors createTranscriptionJob() but sets sourceType IMAGE.
   */
  async createImageAnalysisJob(
    params: CreateImageAnalysisJobParams,
    workspaceId: string,
  ): Promise<{ mode: string; id: string; status: string; message: string }> {
    this.logger.log(
      `Creating background image analysis: consultation=${params.consultationId}, doctor=${params.doctorId}`,
    );

    const transcription = this.transcriptionRepo.create({
      id: uuidv4(),
      workspaceId,
      doctorId: params.doctorId,
      consultationId: params.consultationId,
      audioFilePath: null,
      imageFilePath: params.imageFilePath,
      imageFileSizeBytes: params.imageFileSizeBytes || null,
      sourceType: TranscriptionSourceType.IMAGE,
      mode: TranscriptionMode.BACKGROUND,
      status: TranscriptionStatus.PENDING,
      currentStep: TranscriptionStep.UPLOAD,
      provider: params.provider || AIProvider.OPENAI,
      model: params.model || '',
      temperature: params.temperature ?? 0.0,
      language: params.language || 'en',
      context: params.context || '',
      noteType: params.noteType || null,
      templateId: params.templateId || null,
      patientName: params.patientName || null,
      progressPercentage: 0,
      progressMessage: 'Image file queued for analysis',
      retryCount: 0,
    } as any) as unknown as TranscriptionJob;

    await this.transcriptionRepo.save(transcription);

    this.logger.log(
      `Background image analysis created: ${transcription.id}, triggering immediate processing`,
    );

    // Trigger immediate processing
    setTimeout(() => {
      this.processPendingTranscriptions().catch((err) => {
        this.logger.error(
          `Immediate processing trigger failed: ${err.message}`,
          err.stack,
        );
      });
    }, 100);

    // Audit log
    await this.safeAuditLog(
      {
        userId: params.doctorId,
        action: 'createImageAnalysisJob',
        eventType: AuditEventType.CREATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'TranscriptionJob',
        resourceId: transcription.id,
        metadata: {
          action: NoteAuditActionType.AI_GENERATE,
          consultationId: params.consultationId,
          provider: params.provider,
          mode: TranscriptionMode.BACKGROUND,
          sourceType: TranscriptionSourceType.IMAGE,
        },
      },
      workspaceId,
    );

    return {
      mode: 'BACKGROUND',
      id: transcription.id,
      status: TranscriptionStatus.PENDING,
      message: 'Image file queued for background analysis',
    };
  }

  /**
   * Cancel a transcription job.
   *
   * Only cancellable if not already in a terminal state
   * (COMPLETED, PENDING_NOTE_GENERATION, NOTE_GENERATED, FAILED, CANCELLED).
   *
   * @param processId - Transcription job ID
   * @param userId - The requesting user (must be the owning doctor)
   * @param workspaceId - Tenant workspace ID
   * @returns Success status and message
   */
  async cancelTranscription(
    processId: string,
    userId: string,
    workspaceId: string,
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Cancelling transcription: ${processId}`);

    const transcription = await this.transcriptionRepo.findOne({
      where: { id: processId, workspaceId },
    });

    if (!transcription) {
      throw new NotFoundException(
        `Transcription job not found: ${processId}`,
      );
    }

    // Authorization check
    if (transcription.doctorId !== userId) {
      throw new ForbiddenException(
        'You are not authorized to cancel this transcription',
      );
    }

    // Check if cancellable
    if (!transcription.canCancel()) {
      throw new BadRequestException(
        `Cannot cancel transcription in status: ${transcription.status}. ` +
          'Only pending or in-progress transcriptions can be cancelled.',
      );
    }

    transcription.markAsCancelled();
    await this.transcriptionRepo.save(transcription);

    // Notify connected clients
    this.gateway.emitCancelled(workspaceId, userId, this.buildEvent(transcription));

    this.logger.log(`Transcription cancelled: ${processId}`);

    await this.safeAuditLog(
      {
        userId,
        action: 'cancelTranscription',
        eventType: AuditEventType.UPDATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'TranscriptionJob',
        resourceId: processId,
        metadata: { action: 'cancel', previousStatus: transcription.status },
      },
      workspaceId,
    );

    return { success: true, message: 'Transcription cancelled successfully' };
  }

  /**
   * Retry a failed or cancelled transcription job.
   *
   * Resets the job back to PENDING/UPLOAD state so the processing pipeline
   * picks it up again. Only works if the original audio file still exists
   * on disk.
   *
   * @param jobId - Transcription job ID
   * @param workspaceId - Tenant workspace ID
   * @param userId - The requesting user (must be the owning doctor)
   * @returns The reset job as a list item DTO
   */
  async retryFailedJob(
    jobId: string,
    workspaceId: string,
    userId: string,
  ): Promise<TranscriptionItemDto> {
    this.logger.log(`Retrying failed transcription job: ${jobId}`);

    const job = await this.transcriptionRepo.findOne({
      where: { id: jobId, workspaceId },
    });

    if (!job) {
      throw new NotFoundException(
        `Transcription job not found: ${jobId}`,
      );
    }

    // Authorization check
    if (job.doctorId !== userId) {
      throw new ForbiddenException(
        'You are not authorized to retry this transcription',
      );
    }

    // Only FAILED or CANCELLED jobs can be retried
    if (
      job.status !== TranscriptionStatus.FAILED &&
      job.status !== TranscriptionStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Cannot retry transcription in status: ${job.status}. ` +
          'Only FAILED or CANCELLED transcriptions can be retried.',
      );
    }

    // Verify the audio file still exists on disk
    if (!job.audioFilePath || !fs.existsSync(job.audioFilePath)) {
      throw new BadRequestException(
        'Cannot retry transcription: the original audio file no longer exists on disk.',
      );
    }

    const previousStatus = job.status;

    // Reset the job to its initial state for reprocessing
    job.status = TranscriptionStatus.PENDING;
    job.currentStep = TranscriptionStep.UPLOAD;
    job.retryCount = 0;
    job.progressPercentage = 0;
    job.progressMessage = null;
    job.errorMessage = null;
    job.errorDetails = null;
    job.startedAt = null;
    job.completedAt = null;
    job.processingTimeMs = null;

    await this.transcriptionRepo.save(job);

    this.logger.log(
      `Transcription job reset for retry: ${jobId} (was ${previousStatus})`,
    );

    await this.safeAuditLog(
      {
        userId,
        action: 'retryFailedJob',
        eventType: AuditEventType.UPDATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'TranscriptionJob',
        resourceId: jobId,
        metadata: { action: 'retry', previousStatus },
      },
      workspaceId,
    );

    return this.mapTranscriptionToDto(job);
  }

  /**
   * Get the status of a transcription job.
   *
   * Returns detailed status including progress percentage/message, step, and
   * transcript IDs. Validates that the requesting user is the owning doctor.
   *
   * @param processId - Transcription job ID
   * @param userId - The requesting user
   * @param workspaceId - Tenant workspace ID
   * @returns Detailed transcription status
   */
  async getTranscriptionStatus(
    processId: string,
    userId: string,
    workspaceId: string,
  ): Promise<TranscriptionStatusDto> {
    this.logger.debug(`Getting transcription status: ${processId}`);

    const t = await this.transcriptionRepo.findOne({
      where: { id: processId, workspaceId },
    });

    if (!t) {
      throw new NotFoundException(
        `Transcription job not found: ${processId}`,
      );
    }

    if (t.doctorId !== userId) {
      throw new ForbiddenException(
        'You are not authorized to view this transcription',
      );
    }

    return this.mapToStatusDto(t);
  }

  /**
   * Get the completed transcript from a transcription job.
   *
   * Works for transcriptions in COMPLETED, PENDING_NOTE_GENERATION or
   * NOTE_GENERATED status. Returns both the process info and the associated
   * RecordingsTranscript.
   *
   * @param processId - Transcription job ID
   * @param userId - The requesting user (must be the owning doctor)
   * @param workspaceId - Tenant workspace ID
   * @returns Process info and transcript DTO
   */
  async getCompletedTranscription(
    processId: string,
    userId: string,
    workspaceId: string,
  ): Promise<{ processInfo: TranscriptionStatusDto; transcript: any }> {
    this.logger.debug(`Getting completed transcription: ${processId}`);

    const t = await this.transcriptionRepo.findOne({
      where: { id: processId, workspaceId },
    });

    if (!t) {
      throw new NotFoundException(
        `Transcription job not found: ${processId}`,
      );
    }

    if (t.doctorId !== userId) {
      throw new ForbiddenException(
        'You are not authorized to view this transcription',
      );
    }

    if (!t.transcriptId) {
      throw new BadRequestException(
        `Transcription is not yet complete. Current status: ${t.status}`,
      );
    }

    // Load the associated RecordingsTranscript
    const transcript = await this.dataSource.manager.findOne(
      RecordingsTranscript,
      { where: { id: t.transcriptId, workspaceId } },
    );

    if (!transcript) {
      throw new NotFoundException(
        `Associated transcript not found: ${t.transcriptId}`,
      );
    }

    // ── Lazy structuring ──────────────────────────────────────────────────────
    // If the job was saved with isStructured=false (e.g. legacy record or a
    // previous structuring failure), attempt to structure it now before
    // returning. This is non-fatal: if structuring fails the raw transcript
    // is still returned so the doctor is never blocked.
    if (!t.isStructured && transcript.transcribedText) {
      try {
        const structuredResult = await this.aiNoteService.generateStructuredTranscript({
          rawText:        transcript.transcribedText,
          consultationId: transcript.consultationId,
          audioFilePath:  transcript.audioFilePath,
          provider:       transcript.aiProvider,
          model:          transcript.modelUsed,
          userId:         transcript.doctorId,
          workspaceId:    transcript.workspaceId,
          context:        '',
          temperature:    0.3,
        });

        if (structuredResult?.structuredTranscript) {
          const candidateText = structuredResult.structuredTranscript.trim();
          const rawTrimmed    = transcript.transcribedText.trim().toLowerCase();

          if (candidateText && candidateText.toLowerCase() !== rawTrimmed) {
            // Persist structured text back to RecordingsTranscript (encrypt for at-rest)
            const encryptedCandidate = await this.aesService.encrypt(candidateText);
            await this.dataSource.manager.update(
              RecordingsTranscript,
              { id: transcript.id },
              { structuredTranscript: encryptedCandidate },
            );
            transcript.structuredTranscript = candidateText;

            // Mark the job as properly structured
            t.isStructured      = true;
            t.transcriptPreview = candidateText.slice(0, 500);
            await this.transcriptionRepo.save(t);

            this.logger.log(
              `Lazy-structured transcript ${transcript.id} for job ${t.id}`,
            );
          }
        }
      } catch (err) {
        this.logger.warn(
          `Lazy structuring failed for job ${t.id}: ${(err as Error).message}`,
        );
        // Non-fatal — fall through and return whatever transcript we have
      }
    }

    return {
      processInfo: this.mapToStatusDto(t),
      transcript: this.mapToTranscriptDto(transcript),
    };
  }

  /**
   * Get completed transcript DTO only (shorthand).
   */
  async getCompletedTranscriptOnly(
    processId: string,
    userId: string,
    workspaceId: string,
  ): Promise<any> {
    const result = await this.getCompletedTranscription(
      processId,
      userId,
      workspaceId,
    );
    return result.transcript;
  }

  /**
   * Get all transcriptions for a user with optional filtering.
   *
   * Returns items shaped with typed columns — no JSON blob parsing required.
   *
   * @param userId - Doctor ID
   * @param workspaceId - Tenant workspace ID
   * @param filters - Optional filters
   * @returns Paginated list of transcription items
   */
  async getUserTranscriptions(
    userId: string,
    workspaceId: string,
    filters?: TranscriptionFilters,
  ): Promise<{
    items: TranscriptionItemDto[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    this.logger.debug(`Getting transcriptions for user: ${userId}`);

    const limit = filters?.limit || 10;
    const offset = filters?.offset || 0;
    const page = Math.floor(offset / limit) + 1;

    const [transcriptions, total] = await this.transcriptionRepo.findByDoctor(
      userId,
      workspaceId,
      {
        status: filters?.status,
        mode: filters?.mode,
        consultationId: filters?.consultationId,
        limit,
        offset,
      },
    );

    const items = transcriptions.map((t) => this.mapTranscriptionToDto(t));
    const totalPages = Math.ceil(total / limit);

    return {
      items,
      meta: { total, page, limit, totalPages },
    };
  }

  /**
   * Get transcriptions ready for note generation.
   * Covers STANDARD (COMPLETED) and BACKGROUND (PENDING_NOTE_GENERATION) jobs.
   */
  async getDoctorTranscriptionsReadyForNoteGeneration(
    userId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<{
    items: TranscriptionItemDto[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    // Collect both COMPLETED (STANDARD) and PENDING_NOTE_GENERATION (BACKGROUND)
    const [completed, completedTotal] =
      await this.transcriptionRepo.findByDoctorAndStatus(
        userId,
        workspaceId,
        TranscriptionStatus.COMPLETED,
        page,
        limit,
      );
    const [pending, pendingTotal] =
      await this.transcriptionRepo.findByDoctorAndStatus(
        userId,
        workspaceId,
        TranscriptionStatus.PENDING_NOTE_GENERATION,
        page,
        limit,
      );

    const allItems = [...completed, ...pending].map((t) =>
      this.mapTranscriptionToDto(t),
    );

    const total = completedTotal + pendingTotal;
    const totalPages = Math.ceil(total / limit);

    return {
      items: allItems,
      meta: { total, page, limit, totalPages },
    };
  }

  /**
   * Get failed transcriptions for a doctor.
   */
  async getDoctorFailedTranscriptions(
    userId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<{
    items: TranscriptionItemDto[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    return this.getTranscriptionsByStatus(
      userId,
      workspaceId,
      TranscriptionStatus.FAILED,
      page,
      limit,
    );
  }

  /**
   * Get completed (note generated) transcriptions for a doctor.
   */
  async getDoctorCompletedTranscriptions(
    userId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<{
    items: TranscriptionItemDto[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    return this.getTranscriptionsByStatus(
      userId,
      workspaceId,
      TranscriptionStatus.NOTE_GENERATED,
      page,
      limit,
    );
  }

  // ===========================================================================
  // PRIVATE METHODS — Processing Pipeline
  // ===========================================================================

  /**
   * Main polling loop: Fetch pending BACKGROUND jobs and process them concurrently.
   *
   * Runs every 10 seconds (triggered via setInterval in onModuleInit).
   * Processes up to BATCH_SIZE items per cycle using Promise.allSettled for
   * concurrent execution. Protected by isProcessing lock (in-process) and
   * database-level optimistic locking via claimJob() to prevent duplicate
   * processing across multiple instances.
   */
  private async processPendingTranscriptions(): Promise<void> {
    if (this.isProcessing) {
      return; // Skip if already processing
    }

    this.isProcessing = true;

    try {
      const pending = await this.transcriptionRepo.findAllPending(this.BATCH_SIZE);

      // Filter to BACKGROUND mode only — STANDARD jobs should never be in PENDING
      // state when the poller runs (they complete synchronously within the request)
      const backgroundPending = pending.filter(
        (t) => t.mode === TranscriptionMode.BACKGROUND || !t.mode,
      );

      if (backgroundPending.length > 0) {
        this.logger.debug(
          `Processing ${backgroundPending.length} pending background transcriptions`,
        );

        // Claim jobs atomically to prevent duplicate processing across instances
        const claimedJobs: TranscriptionJob[] = [];
        for (const transcription of backgroundPending) {
          const claimed = await this.claimJob(transcription.id);
          if (claimed) {
            claimedJobs.push(claimed);
          }
        }

        if (claimedJobs.length === 0) {
          this.logger.debug('No jobs claimed (already taken by another instance)');
        } else {
          // Process claimed jobs concurrently
          const results = await Promise.allSettled(
            claimedJobs.map((transcription) => this.processTranscription(transcription)),
          );

          for (let i = 0; i < results.length; i++) {
            if (results[i].status === 'rejected') {
              const reason = (results[i] as PromiseRejectedResult).reason;
              this.logger.error(
                `Failed to process transcription ${claimedJobs[i].id}: ${reason.message}`,
                reason.stack,
              );
            }
          }
        }
      }

      // Handle stuck processes
      await this.handleStuckProcesses();
    } catch (error) {
      this.logger.error(
        `Polling cycle error: ${error.message}`,
        error.stack,
      );
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Atomically claim a job for processing using an UPDATE ... WHERE condition.
   * Only succeeds if the job is still in PENDING status, preventing duplicate
   * processing across multiple app instances.
   *
   * @returns The claimed TranscriptionJob entity, or null if already claimed
   */
  private async claimJob(jobId: string): Promise<TranscriptionJob | null> {
    const result = await this.transcriptionRepo
      .createQueryBuilder()
      .update(TranscriptionJob)
      .set({ status: TranscriptionStatus.PROCESSING, startedAt: new Date() })
      .where('id = :jobId AND status = :pending AND mode = :background', {
        jobId,
        pending: TranscriptionStatus.PENDING,
        background: TranscriptionMode.BACKGROUND,
      })
      .execute();

    if (result.affected === 0) {
      return null; // Already claimed by another instance
    }

    // Re-fetch the full entity for pipeline processing
    return this.transcriptionRepo.findOne({ where: { id: jobId } });
  }

  /**
   * Process a single BACKGROUND transcription through the full pipeline.
   *
   * Steps (within a transaction):
   * 1. Emit PROCESSING progress (already claimed by claimJob)
   * 2. Mark as TRANSCRIBING — call AI transcription with fallback (with timeout)
   * 3. Mark as TRANSCRIBED (stores rawTranscribedText on entity)
   * 4. Mark as STRUCTURING — call AI structured transcript generation (with timeout)
   * 5. Mark as SAVING
   * 6. markAsCompleted() → status becomes PENDING_NOTE_GENERATION
   *
   * On failure: increment retryCount. If < MAX_RETRIES, reset to PENDING.
   * After MAX_RETRIES failures, mark as permanently FAILED.
   */
  private async processTranscription(
    transcription: TranscriptionJob,
  ): Promise<void> {
    const operationId = `bg_process_${transcription.id}_${Date.now()}`;

    this.logger.log(
      `[${operationId}] Starting pipeline for transcription: ${transcription.id}`,
    );

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Read provider config from typed columns — no JSON blob needed
      const provider = (transcription.provider as AIProvider) || AIProvider.OPENAI;
      const model = transcription.model || '';
      // parseFloat guards against MySQL returning DECIMAL as a string (TypeORM quirk)
      const temperature = parseFloat(transcription.temperature as any) || 0.0;
      const language = transcription.language || 'en';
      const context = transcription.context || '';

      // Step 1: Emit PROCESSING progress (already claimed via claimJob)
      transcription.markAsProcessing();
      await this.encryptJobFields(transcription);
      await queryRunner.manager.save(TranscriptionJob, transcription);
      await this.decryptJobFields(transcription);
      this.gateway.emit(transcription.workspaceId, transcription.doctorId, this.buildEvent(transcription));
      this.logger.debug(`[${operationId}] Step 1/6: PROCESSING`);

      // Step 2: Transcribe audio or analyze image via AI with fallback (with timeout)
      const isImageSource = transcription.sourceType === TranscriptionSourceType.IMAGE;

      if (isImageSource) {
        transcription.markAsProcessing();
      } else {
        transcription.markAsTranscribing();
      }
      await this.encryptJobFields(transcription);
      await queryRunner.manager.save(TranscriptionJob, transcription);
      await this.decryptJobFields(transcription);
      this.gateway.emit(transcription.workspaceId, transcription.doctorId, this.buildEvent(transcription));
      this.logger.debug(`[${operationId}] Step 2/6: ${isImageSource ? 'ANALYZING IMAGE' : 'TRANSCRIBING'}`);

      const transcriptionResult: { text?: string; provider?: string; model?: string } =
        isImageSource
          ? await this.withTimeout(
              (this.aiNoteService as any).analyzeImageWithFallback(
                transcription.imageFilePath,
                uuidv4(),
                context,
                language,
                provider,
                transcription.doctorId,
                transcription.workspaceId,
              ),
              this.AI_CALL_TIMEOUT_MS,
              `AI image analysis timed out after ${this.AI_CALL_TIMEOUT_MS / 1000}s`,
            )
          : await this.withTimeout(
              (this.aiNoteService as any).transcribeWithFallback(
                transcription.audioFilePath,
                uuidv4(),
                language,
                provider,
                transcription.doctorId,
                transcription.workspaceId,
                transcription.audioDurationSeconds,
              ),
              this.AI_CALL_TIMEOUT_MS,
              `AI transcription timed out after ${this.AI_CALL_TIMEOUT_MS / 1000}s`,
            );

      if (!transcriptionResult || !transcriptionResult.text) {
        throw new Error(isImageSource ? 'Image analysis returned empty result' : 'Audio transcription returned empty result');
      }

      // Check if cancelled while AI was transcribing
      await this.checkCancelled(transcription.id);

      const rawText = transcriptionResult.text;

      // Step 3: Mark as TRANSCRIBED — stores rawTranscribedText on entity
      transcription.markAsTranscribed(rawText);
      await this.encryptJobFields(transcription);
      await queryRunner.manager.save(TranscriptionJob, transcription);
      await this.decryptJobFields(transcription);
      this.gateway.emit(transcription.workspaceId, transcription.doctorId, this.buildEvent(transcription));
      this.logger.debug(
        `[${operationId}] Step 3/6: TRANSCRIBED (${rawText.length} chars)`,
      );

      // Step 4: Generate structured transcript (with timeout)
      transcription.markAsStructuring();
      await this.encryptJobFields(transcription);
      await queryRunner.manager.save(TranscriptionJob, transcription);
      await this.decryptJobFields(transcription);
      this.gateway.emit(transcription.workspaceId, transcription.doctorId, this.buildEvent(transcription));
      this.logger.debug(`[${operationId}] Step 4/6: STRUCTURING`);

      // ── Robust AI structuring with retry loop ──────────────────────────
      // The user must ALWAYS get a structured transcript. We retry up to
      // MAX_STRUCTURE_ATTEMPTS times, alternating between the full service
      // call and a direct strategy call, with exponential back-off.
      const MAX_STRUCTURE_ATTEMPTS = 3;
      const rawTrimmed = rawText.trim().toLowerCase();
      const resolvedProvider = (transcriptionResult.provider as AIProvider) || provider;
      const resolvedModel = transcriptionResult.model || model;

      let structuredText = rawText;
      let transcriptEntityId: string | null = null; // ID of the saved RecordingsTranscript
      let structuredSuccessfully = false;

      for (let attempt = 1; attempt <= MAX_STRUCTURE_ATTEMPTS; attempt++) {
        await this.checkCancelled(transcription.id);

        this.logger.log(
          `[${operationId}] Structuring attempt ${attempt}/${MAX_STRUCTURE_ATTEMPTS}`,
        );

        try {
          if (attempt === 1 || attempt === 3) {
            // Attempts 1 & 3: full service call (creates/updates RecordingsTranscript)
            const structuredResult = await this.withTimeout(
              this.aiNoteService.generateStructuredTranscript({
                rawText,
                consultationId: transcription.consultationId,
                audioFilePath: isImageSource ? undefined : transcription.audioFilePath,
                imageFilePath: isImageSource ? transcription.imageFilePath || undefined : undefined,
                sourceType: isImageSource ? TranscriptionSourceType.IMAGE : TranscriptionSourceType.AUDIO,
                provider: resolvedProvider,
                model: resolvedModel,
                userId: transcription.doctorId,
                workspaceId: transcription.workspaceId,
                context,
                temperature,
              }),
              this.AI_STRUCTURE_TIMEOUT_MS,
              `AI structuring timed out (attempt ${attempt})`,
            );

            if (structuredResult?.structuredTranscript) {
              transcriptEntityId = structuredResult.id;
              const candidateText = structuredResult.structuredTranscript.trim();
              if (candidateText.toLowerCase() !== rawTrimmed) {
                structuredText = candidateText;
                structuredSuccessfully = true;
                this.logger.log(
                  `[${operationId}] Attempt ${attempt} succeeded via service (len=${structuredText.length})`,
                );
                break;
              } else {
                this.logger.warn(
                  `[${operationId}] Attempt ${attempt}: structured text identical to raw — retrying`,
                );
              }
            } else {
              this.logger.warn(
                `[${operationId}] Attempt ${attempt}: service returned null/empty result — retrying`,
              );
            }
          } else {
            // Attempt 2: direct strategy call (bypasses service wrapper)
            const strategy = (this.aiNoteService as any).aiStrategyFactory.getStrategy(resolvedProvider);
            const directStartTime = Date.now();
            const directResult: any = await this.withTimeout(
              strategy.generateStructuredTranscript(rawText, temperature, resolvedModel, context),
              this.AI_STRUCTURE_TIMEOUT_MS,
              `AI direct structuring timed out (attempt ${attempt})`,
            );
            const directResponseTime = Date.now() - directStartTime;

            if (directResult?.choices?.[0]?.message?.content) {
              const candidateText = (directResult.choices[0].message.content as string).trim();
              if (candidateText && candidateText.toLowerCase() !== rawTrimmed) {
                structuredText = candidateText;
                structuredSuccessfully = true;
                // Update existing transcript entity if we have one, or create one below
                if (transcriptEntityId) {
                  const encryptedStructured = await this.aesService.encrypt(structuredText);
                  await queryRunner.manager.update(
                    RecordingsTranscript,
                    { id: transcriptEntityId },
                    { structuredTranscript: encryptedStructured },
                  );
                }
                // Report usage (fire-and-forget)
                const tokenUsage = (strategy as any).getLastTokenUsage?.() || { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
                this.aiUsageReportingService.reportUsage({
                  userId: transcription.doctorId,
                  workspaceId: transcription.workspaceId,
                  provider: resolvedProvider,
                  model: resolvedModel,
                  operation: AiOperation.STRUCTURED_TRANSCRIPT,
                  tokenUsage,
                  responseTimeMs: directResponseTime,
                  status: AiUsageStatus.COMPLETED,
                  metadata: { context: 'processTranscription_directStrategy', attempt },
                }).catch(() => {});
                this.logger.log(
                  `[${operationId}] Attempt ${attempt} succeeded via direct strategy (len=${structuredText.length})`,
                );
                break;
              } else {
                this.logger.warn(
                  `[${operationId}] Attempt ${attempt}: direct strategy returned identical/empty text — retrying`,
                );
              }
            }
          }
        } catch (attemptError) {
          this.logger.error(
            `[${operationId}] Attempt ${attempt} failed: ${attemptError.message}`,
            attemptError.stack,
          );
        }

        // Exponential back-off between retries (1s, 2s)
        if (attempt < MAX_STRUCTURE_ATTEMPTS) {
          const delayMs = attempt * 1000;
          this.logger.debug(`[${operationId}] Waiting ${delayMs}ms before retry…`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }

      // If no transcript entity was created during attempts, create one now
      if (!transcriptEntityId) {
        const newTranscript = queryRunner.manager.create(RecordingsTranscript, {
          id: uuidv4(),
          workspaceId: transcription.workspaceId,
          doctorId: transcription.doctorId,
          consultationId: transcription.consultationId,
          transcribedText: rawText,
          audioFilePath: isImageSource ? null : transcription.audioFilePath,
          imageFilePath: isImageSource ? transcription.imageFilePath : null,
          sourceType: isImageSource ? TranscriptionSourceType.IMAGE : TranscriptionSourceType.AUDIO,
          structuredTranscript: structuredText,
          aiProvider: resolvedProvider,
          modelUsed: resolvedModel,
        } as any) as unknown as RecordingsTranscript;

        // Encrypt PHI before persisting via queryRunner (bypasses repo)
        await this.encryptTranscriptFields(newTranscript);
        const savedNew = await queryRunner.manager.save(RecordingsTranscript, newTranscript);
        transcriptEntityId = savedNew.id;

        this.logger.log(
          `[${operationId}] Created RecordingsTranscript: ${transcriptEntityId} (structured=${structuredSuccessfully})`,
        );
      }

      if (!structuredSuccessfully) {
        // Never complete a job with isStructured=false. Throw so the outer
        // retry loop re-runs the full pipeline. After MAX outer retries the
        // job is marked FAILED and surfaces in Failed Transcriptions.
        throw new Error(
          `AI structuring failed after ${MAX_STRUCTURE_ATTEMPTS} attempts — ` +
          `job will be retried. Transcript ${transcriptEntityId ?? 'none'} not saved.`,
        );
      }

      // Step 5: Mark as SAVING
      transcription.markAsSaving();
      await this.encryptJobFields(transcription);
      await queryRunner.manager.save(TranscriptionJob, transcription);
      await this.decryptJobFields(transcription);
      this.gateway.emit(transcription.workspaceId, transcription.doctorId, this.buildEvent(transcription));
      this.logger.debug(`[${operationId}] Step 5/6: SAVING`);

      // Step 6: markAsCompleted → BACKGROUND mode sets PENDING_NOTE_GENERATION
      transcription.markAsCompleted(
        transcriptEntityId,
        structuredText,
        transcriptionResult.provider || provider,
        transcriptionResult.model || model,
        structuredSuccessfully,
      );
      await this.encryptJobFields(transcription);
      await queryRunner.manager.save(TranscriptionJob, transcription);
      await this.decryptJobFields(transcription);
      this.logger.debug(
        `[${operationId}] Step 6/6: PENDING_NOTE_GENERATION, transcriptId=${transcriptEntityId}, isStructured=${structuredSuccessfully}`,
      );

      await queryRunner.commitTransaction();

      // Create the persistent notification BEFORE emitting the socket event
      // so the notificationId can be included in the payload. This lets the
      // client use it immediately for dismiss/read API calls.
      let notificationId: string | undefined;
      if (transcription.mode === TranscriptionMode.BACKGROUND) {
        try {
          const notification = await this.notificationsService.send({
            workspaceId: transcription.workspaceId,
            userId: transcription.doctorId,
            title: 'Transcription Complete',
            body: `The AI transcription for ${this.toTitleCase(transcription.patientName ?? 'the patient')} is ready for your review.`,
            type: 'transcription_completed',
            resourceId: transcription.id,
            data: {
              jobId: transcription.id,
              consultationId: transcription.consultationId,
            },
          });
          notificationId = notification.id;
        } catch (err) {
          this.logger.error(
            `[${operationId}] Push notification failed: ${err.message}`,
            err.stack,
          );
        }
      }

      // Emit socket event WITH notificationId so clients get the backendId
      const completedEvent = this.buildEvent(transcription);
      if (notificationId) completedEvent.notificationId = notificationId;
      this.gateway.emitCompleted(transcription.workspaceId, transcription.doctorId, completedEvent);

      this.logger.log(
        `[${operationId}] Pipeline complete for transcription: ${transcription.id}`,
      );
    } catch (error) {
      await queryRunner.rollbackTransaction();

      this.logger.error(
        `[${operationId}] Pipeline failed: ${error.message}`,
        error.stack,
      );

      // If cancelled externally, don't retry — just exit cleanly
      if (error.message === 'JOB_CANCELLED') {
        this.logger.log(
          `[${operationId}] Job was cancelled externally, skipping retry`,
        );
        return;
      }

      // Retry logic
      transcription.retryCount += 1;

      if (transcription.retryCount < this.MAX_RETRIES) {
        // Reset to PENDING for retry
        transcription.status = TranscriptionStatus.PENDING;
        transcription.currentStep = TranscriptionStep.UPLOAD;
        transcription.progressPercentage = 0;
        transcription.progressMessage = `Retry ${transcription.retryCount}/${this.MAX_RETRIES}: ${error.message}`;

        this.logger.warn(
          `[${operationId}] Retry ${transcription.retryCount}/${this.MAX_RETRIES} scheduled`,
        );
      } else {
        // Permanent failure
        transcription.markAsFailed(error.message, {
          stack: error.stack,
          retryCount: transcription.retryCount,
        });

        this.logger.error(
          `[${operationId}] Permanently failed after ${this.MAX_RETRIES} retries`,
        );
      }

      // Save the retry/failure state (outside the rolled-back transaction)
      await this.transcriptionRepo.save(transcription);

      // Notify clients: emit progress (retry) or failed (permanent)
      if (transcription.status === TranscriptionStatus.FAILED) {
        // Create persistent notification BEFORE socket emit (same pattern as completion)
        let failedNotificationId: string | undefined;
        if (transcription.mode === TranscriptionMode.BACKGROUND) {
          try {
            const notification = await this.notificationsService.send({
              workspaceId: transcription.workspaceId,
              userId: transcription.doctorId,
              title: 'Transcription Failed',
              body: `The AI transcription for ${this.toTitleCase(transcription.patientName ?? 'the patient')} could not be completed.`,
              type: 'transcription_failed',
              resourceId: transcription.id,
              data: {
                jobId: transcription.id,
                consultationId: transcription.consultationId,
              },
            });
            failedNotificationId = notification.id;
          } catch (err) {
            this.logger.error(
              `[${operationId}] Push notification failed: ${err.message}`,
              err.stack,
            );
          }
        }

        const failedEvent = this.buildEvent(transcription);
        if (failedNotificationId) failedEvent.notificationId = failedNotificationId;
        this.gateway.emitFailed(transcription.workspaceId, transcription.doctorId, failedEvent);
      } else {
        this.gateway.emit(transcription.workspaceId, transcription.doctorId, this.buildEvent(transcription));
      }
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Detect and handle transcriptions stuck in PROCESSING state.
   *
   * Any transcription in PROCESSING status for longer than STUCK_TIMEOUT_MINUTES
   * is marked as FAILED with a timeout error.
   */
  private async handleStuckProcesses(): Promise<void> {
    try {
      const stuckProcesses = await this.transcriptionRepo.findStuckProcesses(
        this.STUCK_TIMEOUT_MINUTES,
      );

      if (stuckProcesses.length > 0) {
        this.logger.warn(
          `Found ${stuckProcesses.length} stuck transcription(s), marking as failed`,
        );

        for (const stuck of stuckProcesses) {
          stuck.markAsFailed(
            `Process timed out after ${this.STUCK_TIMEOUT_MINUTES} minutes`,
            { timeout: true, lastStep: stuck.currentStep },
          );
          await this.transcriptionRepo.save(stuck);

          // Notify connected clients about the timeout failure
          this.gateway.emitFailed(
            stuck.workspaceId,
            stuck.doctorId,
            this.buildEvent(stuck),
          );

          // Send push notification for background stuck timeouts
          if (stuck.mode === TranscriptionMode.BACKGROUND) {
            this.notificationsService
              .send({
                workspaceId: stuck.workspaceId,
                userId: stuck.doctorId,
                title: 'Transcription Failed',
                body: `The AI transcription for ${this.toTitleCase(stuck.patientName ?? 'the patient')} timed out.`,
                type: 'transcription_failed',
                resourceId: stuck.id,
                data: {
                  jobId: stuck.id,
                  consultationId: stuck.consultationId,
                },
              })
              .catch((err) =>
                this.logger.error(
                  `Push notification failed for stuck job ${stuck.id}: ${err.message}`,
                  err.stack,
                ),
              );
          }

          this.logger.warn(
            `Marked stuck transcription ${stuck.id} as FAILED (timeout)`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle stuck processes: ${error.message}`,
        error.stack,
      );
    }
  }

  // ===========================================================================
  // PRIVATE METHODS — Helpers
  // ===========================================================================

  /**
   * Get transcriptions for a doctor by status with pagination.
   */
  private async getTranscriptionsByStatus(
    userId: string,
    workspaceId: string,
    status: TranscriptionStatus,
    page: number,
    limit: number,
  ): Promise<{
    items: TranscriptionItemDto[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const [transcriptions, total] =
      await this.transcriptionRepo.findByDoctorAndStatus(
        userId,
        workspaceId,
        status,
        page,
        limit,
      );

    const items = transcriptions.map((t) => this.mapTranscriptionToDto(t));
    const totalPages = Math.ceil(total / limit);

    return {
      items,
      meta: { total, page, limit, totalPages },
    };
  }

  /**
   * Converts a patient name to title case regardless of how it is stored.
   * e.g. "IDAISHE NZIRA" → "Idaishe Nzira", "john doe" → "John Doe"
   */
  private toTitleCase(name: string): string {
    return name
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  /**
   * Build the WebSocket event payload from a TranscriptionJob entity.
   * Maps all display-critical typed columns to the event shape.
   */
  private buildEvent(t: TranscriptionJob): TranscriptionProgressEvent {
    return {
      jobId:               t.id,
      doctorId:            t.doctorId,
      workspaceId:         t.workspaceId,
      mode:                t.mode,
      status:              t.status,
      currentStep:         t.currentStep,
      progressPercentage:  t.progressPercentage ?? 0,
      progressMessage:     t.progressMessage ?? '',
      consultationId:      t.consultationId,
      patientName:         t.patientName || undefined,
      noteType:            t.noteType || undefined,
      transcriptId:        t.transcriptId || undefined,
      noteId:              t.noteId || undefined,
      transcriptPreview:   t.transcriptPreview || undefined,
      isStructured:        t.isStructured ?? false,
      resolvedProvider:    t.resolvedProvider || undefined,
      resolvedModel:       t.resolvedModel || undefined,
      processingTimeMs:    t.processingTimeMs || undefined,
      errorMessage:        t.errorMessage || undefined,
      startedAt:           t.startedAt || undefined,
      completedAt:         t.completedAt || undefined,
      updatedAt:           t.updatedAt ?? new Date(),
      sourceType:          t.sourceType || undefined,
    };
  }

  /**
   * Map a TranscriptionJob entity to a TranscriptionItemDto.
   * Uses typed columns directly — no JSON blob parsing required.
   */
  private mapTranscriptionToDto(t: TranscriptionJob): TranscriptionItemDto {
    return {
      id: t.id,
      sourceType: t.sourceType || undefined,
      mode: t.mode,
      status: t.status,
      currentStep: t.currentStep,
      progressPercentage: t.progressPercentage ?? 0,
      progressMessage: t.progressMessage ?? '',
      consultationId: t.consultationId,
      patientName: t.patientName || undefined,
      transcriptId: t.transcriptId || undefined,
      noteId: t.noteId || undefined,
      noteType: t.noteType || undefined,
      transcriptPreview: t.transcriptPreview || undefined,
      isStructured: t.isStructured ?? false,
      resolvedProvider: t.resolvedProvider || undefined,
      resolvedModel: t.resolvedModel || undefined,
      processingTimeMs: t.processingTimeMs || undefined,
      audioFileSizeBytes: t.audioFileSizeBytes || undefined,
      audioDurationSeconds: t.audioDurationSeconds || undefined,
      imageFilePath: t.imageFilePath || undefined,
      imageFileSizeBytes: t.imageFileSizeBytes || undefined,
      errorMessage: t.errorMessage || undefined,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      startedAt: t.startedAt || undefined,
      completedAt: t.completedAt || undefined,
      noteGeneratedAt: t.noteGeneratedAt || undefined,
      retryCount: t.retryCount,
    };
  }

  /**
   * Map a TranscriptionJob entity to a TranscriptionStatusDto (full detail).
   */
  private mapToStatusDto(t: TranscriptionJob): TranscriptionStatusDto {
    return {
      id: t.id,
      mode: t.mode,
      status: t.status,
      currentStep: t.currentStep,
      progressPercentage: t.progressPercentage ?? 0,
      progressMessage: t.progressMessage ?? '',
      rawTranscribedText: t.rawTranscribedText || undefined,
      transcriptPreview: t.transcriptPreview || undefined,
      transcriptId: t.transcriptId || undefined,
      consultationId: t.consultationId,
      patientName: t.patientName || undefined,
      provider: t.provider || undefined,
      model: t.model || undefined,
      language: t.language || undefined,
      noteType: t.noteType || undefined,
      resolvedProvider: t.resolvedProvider || undefined,
      resolvedModel: t.resolvedModel || undefined,
      processingTimeMs: t.processingTimeMs || undefined,
      errorMessage: t.errorMessage || undefined,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      startedAt: t.startedAt || undefined,
      completedAt: t.completedAt || undefined,
      retryCount: t.retryCount,
    };
  }

  /**
   * Map a RecordingsTranscript entity to a response DTO.
   */
  private mapToTranscriptDto(transcript: RecordingsTranscript): any {
    return {
      id: transcript.id,
      workspaceId: transcript.workspaceId,
      consultationId: transcript.consultationId,
      doctorId: transcript.doctorId,
      transcribedText: transcript.transcribedText,
      structuredTranscript: transcript.structuredTranscript,
      audioFilePath: transcript.audioFilePath,
      provider: transcript.aiProvider,
      model: transcript.modelUsed,
      createdAt: transcript.createdAt,
      updatedAt: transcript.updatedAt,
    };
  }

  /**
   * Check if a job has been cancelled externally (e.g. by the user via REST API)
   * while the pipeline was running. Reads fresh status from DB to detect the race.
   * Throws if cancelled so the pipeline exits cleanly.
   */
  private async checkCancelled(jobId: string): Promise<void> {
    const fresh = await this.transcriptionRepo.findOne({
      where: { id: jobId },
      select: ['id', 'status'],
    });
    if (fresh?.status === TranscriptionStatus.CANCELLED) {
      throw new Error('JOB_CANCELLED');
    }
  }

  /**
   * Wrap a promise with a timeout. Rejects with TimeoutError if the promise
   * doesn't resolve within the specified duration.
   */
  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(message));
      }, timeoutMs);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  /**
   * Clean up old completed, failed, and cancelled transcription jobs.
   * Runs periodically (every 6 hours) to prevent unbounded table growth.
   * Only deletes terminal jobs older than JOB_RETENTION_DAYS.
   */
  private async cleanupOldJobs(): Promise<void> {
    try {
      const cutoff = new Date(
        Date.now() - this.JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );

      // NOTE: FAILED jobs are intentionally excluded so their audio files
      // remain on disk and the doctor can retry them via retryFailedJob().
      const result = await this.transcriptionRepo
        .createQueryBuilder()
        .delete()
        .from(TranscriptionJob)
        .where('status IN (:...statuses)', {
          statuses: [
            TranscriptionStatus.NOTE_GENERATED,
            TranscriptionStatus.CANCELLED,
          ],
        })
        .andWhere('updatedAt < :cutoff', { cutoff })
        .execute();

      if (result.affected && result.affected > 0) {
        this.logger.log(
          `Job cleanup: removed ${result.affected} old transcription jobs (older than ${this.JOB_RETENTION_DAYS} days)`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Job cleanup failed: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Non-blocking audit log helper. Catches and logs failures without
   * interrupting the main operation flow.
   */
  private async safeAuditLog(
    dto: {
      userId: string;
      action: string;
      eventType: AuditEventType;
      outcome: AuditOutcome;
      resourceType?: string;
      resourceId?: string;
      metadata?: Record<string, any>;
    },
    workspaceId: string,
  ): Promise<void> {
    try {
      await this.auditLogService.log(
        {
          userId: dto.userId,
          action: dto.action,
          eventType: dto.eventType,
          outcome: dto.outcome,
          resourceType: dto.resourceType,
          resourceId: dto.resourceId,
          metadata: dto.metadata,
        },
        workspaceId,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to create audit log for ${dto.action}: ${error.message}`,
      );
    }
  }

  // ===========================================================================
  // Encryption Helpers (for queryRunner.manager operations that bypass repo)
  // ===========================================================================

  /** Fields on TranscriptionJob that contain PHI and must be encrypted. */
  private static readonly JOB_ENCRYPTED_FIELDS = [
    'rawTranscribedText',
    'transcriptPreview',
    'patientName',
    'context',
  ] as const;

  /** Fields on RecordingsTranscript that contain PHI and must be encrypted. */
  private static readonly TRANSCRIPT_ENCRYPTED_FIELDS = [
    'transcribedText',
    'structuredTranscript',
  ] as const;

  /**
   * Encrypt sensitive fields on a TranscriptionJob before saving
   * via queryRunner.manager (which bypasses the repository's auto-encryption).
   */
  private async encryptJobFields(job: TranscriptionJob): Promise<void> {
    for (const field of TranscriptionJobService.JOB_ENCRYPTED_FIELDS) {
      const value = (job as any)[field];
      if (value && typeof value === 'string') {
        (job as any)[field] = await this.aesService.encrypt(value);
      }
    }
  }

  /**
   * Decrypt sensitive fields on a TranscriptionJob after reading
   * via queryRunner.manager (which bypasses the repository's auto-decryption).
   */
  private async decryptJobFields(job: TranscriptionJob): Promise<void> {
    for (const field of TranscriptionJobService.JOB_ENCRYPTED_FIELDS) {
      const value = (job as any)[field];
      if (value && typeof value === 'string' && this.looksEncrypted(value)) {
        try {
          (job as any)[field] = await this.aesService.decrypt(value);
        } catch {
          this.logger.warn(`Decryption failed for job field ${field} — clearing`);
          (job as any)[field] = null;
        }
      }
    }
  }

  /**
   * Encrypt sensitive fields on a RecordingsTranscript before saving
   * via queryRunner.manager (which bypasses the repository's auto-encryption).
   */
  private async encryptTranscriptFields(transcript: RecordingsTranscript): Promise<void> {
    for (const field of TranscriptionJobService.TRANSCRIPT_ENCRYPTED_FIELDS) {
      const value = (transcript as any)[field];
      if (value && typeof value === 'string') {
        (transcript as any)[field] = await this.aesService.encrypt(value);
      }
    }
  }

  /** AES-256-CBC hex format: 32-char IV + ':' + hex ciphertext */
  private looksEncrypted(value: string): boolean {
    return /^[0-9a-f]{32}:[0-9a-f]{32,}$/.test(value);
  }
}
