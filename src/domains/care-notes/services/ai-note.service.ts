import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner , IsNull } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { LoggerService } from '../../../common/logger/logger.service';
import { FileStorageService } from '../../../common/storage/file-storage.service';
import { AuditLogService } from '../../audit/services/audit-log.service';

import { CareNoteRepository } from '../repositories/care-note.repository';
import { RecordingsTranscriptRepository } from '../repositories/recordings-transcript.repository';

import { CareNotesService } from './care-notes.service';
import { CareNoteResponseDto } from '../dto/care-note-response.dto';
import { NoteTemplateService } from './note-template.service';
import { TranscriptionJobService } from './transcription-job.service';
import { TranscriptionJobRepository } from '../repositories/transcription-job.repository';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { TranscriptionJob } from '../entities/transcription-job.entity';

import { AiStrategyFactory } from '../strategies/ai-strategy.factory';

import { CareNote } from '../entities/care-note.entity';
import { RecordingsTranscript } from '../entities/recordings-transcript.entity';
import { CareAiNoteSource } from '../entities/care-ai-note-source.entity';
import { NoteVersion } from '../entities/note-version.entity';

import {
  AIProvider,
  CareNoteType,
  CareNoteStatus,
  AuditEventType,
  AuditOutcome,
  NoteAuditActionType,
  TranscriptionMode,
  TranscriptionStatus,
  TranscriptionStep,
} from '../../../common/enums';

import {
  IAdmissionNote,
  IConsultationNote,
  IGeneralExaminationNote,
  IProcedureNote,
  IOperationNote,
  IProgressNote,
  IDischargeNote,
  IEmergencyNote,
  IFollowUpNote,
  IAllergyStructure,
  ITreatmentStructure,
  IAssessment,
} from '../interfaces/note-content.interface';

// ============================
// Internal DTOs / Param Interfaces
// ============================

/**
 * Parameters for processAudioToNote
 */
interface ProcessAudioDto {
  consultationId: string;
  provider?: AIProvider;
  model?: string;
  language?: string;
  temperature?: number;
  isBackgroundProcessing?: boolean;
  context?: string;
  patientName?: string;
}

/**
 * Parameters for generateNote
 */
interface GenerateNoteDto {
  consultationId: string;
  content: string;
  noteType: CareNoteType;
  templateId?: string;
  provider?: AIProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  title?: string;
  patientId?: string;
  existingNoteId?: string;
}

/**
 * Parameters for regenerateNote
 */
interface RegenerateNoteDto {
  /** User-edited source content to use instead of the stored ai_note_source.sourceContent. */
  content?: string;
  noteType?: CareNoteType;
  provider?: AIProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  reason?: string;
}

/**
 * Parameters for approveAiNote
 */
interface ApproveAiNoteDto {
  action: 'approve' | 'reject';
  reason?: string;
  modifications?: Record<string, any>;
}

/**
 * Transcript query params
 */
interface TranscriptQueryDto {
  provider?: AIProvider;
  model?: string;
  search?: string;
  doctorId?: string;
  consultationId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

/**
 * Parameters for updateTranscriptWithAudio
 */
interface UpdateTranscriptWithAudioDto {
  /** Existing transcript ID — required for the update-existing-transcript path. */
  transcriptId?: string;
  /**
   * AI note source ID — used instead of transcriptId when the note has no linked
   * transcript yet (e.g. created from manual content). The service will merge the
   * new audio transcription with care_ai_note_sources.sourceContent and create a
   * fresh RecordingsTranscript linked back to this source.
   */
  aiNoteSourceId?: string;
  consultationId?: string;
  provider?: AIProvider;
  model?: string;
  language?: string;
  temperature?: number;
  mergeStrategy?: 'append' | 'replace';
  context?: string;
}

/**
 * Parameters for mergeTranscripts
 */
interface MergeTranscriptsDto {
  primaryTranscriptId: string;
  secondaryTranscriptId: string;
  strategy: 'append' | 'prepend' | 'smart';
  context?: string;
  model?: string;
  temperature?: number;
}

/**
 * Parameters for generateAndSaveNoteFromContent
 */
interface GenerateAndSaveNoteFromContentParams {
  consultationId: string;
  content: string;
  noteType: CareNoteType;
  userId: string;
  workspaceId: string;
  templateId?: string;
  provider?: AIProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  title?: string;
  patientId?: string;
  existingNoteId?: string;
  transcriptId?: string;
  sourceContent?: string;
}

/**
 * Parameters for generateStructuredTranscript
 */
interface GenerateStructuredTranscriptParams {
  rawText: string;
  consultationId: string;
  audioFilePath: string;
  provider: AIProvider;
  model: string;
  userId: string;
  workspaceId: string;
  context?: string;
  temperature?: number;
  sourceId?: string;
}

/**
 * Parameters for generateNoteContent (private)
 */
interface GenerateNoteContentParams {
  content: string;
  noteType: CareNoteType;
  provider?: AIProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  templateId?: string;
}

// ============================
// Service Implementation
// ============================

/**
 * AI Note Service
 *
 * Comprehensive service for AI-powered medical note generation and audio transcription.
 *
 * Features:
 * - Audio transcription with multi-provider fallback (OpenAI, Anthropic, Gemini)
 * - Structured transcript generation from raw transcription text
 * - AI-powered note generation for 10+ medical note types
 * - Note regeneration with version history
 * - Transcript management (CRUD, versioning, merging)
 * - Human-in-the-loop approval workflow for AI-generated notes
 * - Audit logging for all operations (HIPAA compliance)
 * - Multi-tenant workspace isolation
 *
 * Note types supported:
 * - Admission, Consultation, General Examination, Procedure, Operation
 * - Orthopedic Operation, Progress, Discharge, Emergency, Follow-Up
 */
@Injectable()
export class AiNoteService {
  private providerHealthStatus: Record<AIProvider, boolean> = {
    [AIProvider.OPENAI]: true,
    [AIProvider.ANTHROPIC]: true,
    [AIProvider.GEMINI]: true,
    [AIProvider.AZURE_AI]: false,
    [AIProvider.CUSTOM]: false,
  };

  constructor(
    private readonly careNoteRepository: CareNoteRepository,
    private readonly transcriptRepository: RecordingsTranscriptRepository,
    private readonly transcriptionJobRepository: TranscriptionJobRepository,
    private readonly careNotesService: CareNotesService,
    private readonly noteTemplateService: NoteTemplateService,
    private readonly fileStorageService: FileStorageService,
    private readonly aiStrategyFactory: AiStrategyFactory,
    @Inject(forwardRef(() => TranscriptionJobService))
    private readonly transcriptionJobService: TranscriptionJobService,
    private readonly auditLogService: AuditLogService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly notificationsService: NotificationsService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {
    this.logger.setContext('AiNoteService');
    this.logger.log('AiNoteService initialized');
  }

  // ===========================================================================
  // PUBLIC METHODS
  // ===========================================================================

  /**
   * Process audio file to generate a structured transcript and optional note.
   *
   * Flow:
   * 1. If background processing requested, delegate (not yet implemented)
   * 2. Transcribe audio via AI provider with fallback
   * 3. Generate structured transcript from raw text
   * 4. Return transcript result
   *
   * @param filePath - Path to uploaded audio file
   * @param dto - Processing configuration
   * @param userId - Authenticated user ID
   * @param workspaceId - Tenant workspace ID
   * @returns Structured transcript with metadata
   */
  async processAudioToNote(
    filePath: string,
    dto: ProcessAudioDto,
    userId: string,
    workspaceId: string,
  ): Promise<any> {
    this.logger.log(
      `Processing audio to note: consultation=${dto.consultationId}, provider=${dto.provider || 'default'}`,
    );

    // Background processing delegation
    if (dto.isBackgroundProcessing) {
      this.logger.log('Delegating to background transcription service');
      return this.transcriptionJobService.createTranscriptionJob(
        {
          doctorId: userId,
          consultationId: dto.consultationId,
          audioFilePath: filePath,
          provider: dto.provider,
          model: dto.model,
          temperature: dto.temperature,
          language: dto.language,
          context: dto.context,
          patientName: dto.patientName,
        },
        workspaceId,
      );
    }

    const startTime = Date.now();

    // Create a STANDARD-mode TranscriptionJob record to track this synchronous
    // transcription so it appears in the job list alongside BACKGROUND jobs.
    const job = this.transcriptionJobRepository.create({
      id: uuidv4(),
      workspaceId,
      doctorId: userId,
      consultationId: dto.consultationId,
      audioFilePath: filePath,
      mode: TranscriptionMode.STANDARD,
      status: TranscriptionStatus.PENDING,
      currentStep: TranscriptionStep.UPLOAD,
      provider: dto.provider || AIProvider.OPENAI,
      model: dto.model || '',
      language: dto.language || 'en',
      temperature: dto.temperature ?? 0.0,
      context: dto.context || '',
      progressPercentage: 0,
      progressMessage: 'Starting transcription…',
      retryCount: 0,
    } as any) as unknown as TranscriptionJob;

    // Save initial PENDING state — fire-and-forget on failure (never block the response)
    await this.transcriptionJobRepository.save(job).catch((err) => {
      this.logger.warn(`Failed to save STANDARD transcription job record: ${err.message}`);
    });

    try {
      // Step 1: Transcribe audio with provider fallback
      job.markAsProcessing();
      job.markAsTranscribing();

      const transcriptionResult = await this.transcribeWithFallback(
        filePath,
        uuidv4(),
        dto.language,
        dto.provider,
      );

      if (!transcriptionResult || !transcriptionResult.text) {
        throw new BadRequestException(
          'Audio transcription returned empty result. Please check the audio file quality.',
        );
      }

      this.logger.log(
        `Audio transcribed successfully in ${Date.now() - startTime}ms, ` +
        `provider=${transcriptionResult.provider}, text length=${transcriptionResult.text.length}`,
      );

      // Step 2: Generate structured transcript and persist
      job.markAsTranscribed(transcriptionResult.text);
      job.markAsStructuring();

      const structuredTranscript = await this.generateStructuredTranscript({
        rawText: transcriptionResult.text,
        consultationId: dto.consultationId,
        audioFilePath: filePath,
        provider: transcriptionResult.provider,
        model: transcriptionResult.model,
        userId,
        workspaceId,
        context: dto.context,
        temperature: dto.temperature,
        sourceId: transcriptionResult.sourceId,
      });

      const totalTime = Date.now() - startTime;

      this.logger.log(
        `Audio-to-note processing complete: transcriptId=${structuredTranscript.id}, totalTime=${totalTime}ms`,
      );

      // Mark STANDARD job as COMPLETED (not PENDING_NOTE_GENERATION)
      job.markAsSaving();
      job.markAsCompleted(
        structuredTranscript.id,
        structuredTranscript.structuredTranscript,
        transcriptionResult.provider,
        transcriptionResult.model,
      );

      // Persist final state — fire-and-forget
      this.transcriptionJobRepository.save(job).catch((err) => {
        this.logger.warn(`Failed to finalize STANDARD transcription job record: ${err.message}`);
      });

      // Audit log
      await this.safeAuditLog({
        userId,
        action: 'processAudioToNote',
        eventType: AuditEventType.CREATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'RecordingsTranscript',
        resourceId: structuredTranscript.id,
        metadata: {
          action: NoteAuditActionType.AI_GENERATE,
          consultationId: dto.consultationId,
          provider: transcriptionResult.provider,
          model: transcriptionResult.model,
          processingTimeMs: totalTime,
          textLength: transcriptionResult.text.length,
          transcriptionJobId: job.id,
          mode: TranscriptionMode.STANDARD,
        },
      }, workspaceId);

      return {
        transcript: this.mapToTranscriptDto(structuredTranscript),
        rawText: transcriptionResult.text,
        provider: transcriptionResult.provider,
        model: transcriptionResult.model,
        processingTimeMs: totalTime,
        transcriptionJobId: job.id,
      };
    } catch (error) {
      this.logger.error(
        `Failed to process audio to note: ${error.message}`,
        error.stack,
      );

      // Mark job as FAILED — fire-and-forget
      job.markAsFailed(error.message, { stack: error.stack });
      this.transcriptionJobRepository.save(job).catch((err) => {
        this.logger.warn(`Failed to save failed STANDARD transcription job: ${err.message}`);
      });

      await this.safeAuditLog({
        userId,
        action: 'processAudioToNote',
        eventType: AuditEventType.CREATE,
        outcome: AuditOutcome.FAILURE,
        resourceType: 'RecordingsTranscript',
        metadata: {
          action: NoteAuditActionType.AI_GENERATE,
          consultationId: dto.consultationId,
          error: error.message,
          transcriptionJobId: job.id,
        },
      }, workspaceId);

      throw error;
    }
  }

  /**
   * Get the status of a background transcription process.
   *
   * Delegates to TranscriptionJobService for detailed process status
   * including current step, progress percentage, and completion info.
   *
   * @param processId - Background transcription process ID
   * @param userId - Authenticated user ID
   * @param workspaceId - Tenant workspace ID
   * @returns Detailed process status
   */
  async getBackgroundProcessStatus(
    processId: string,
    userId: string,
    workspaceId: string,
  ): Promise<any> {
    return this.transcriptionJobService.getTranscriptionStatus(
      processId,
      userId,
      workspaceId,
    );
  }

  /**
   * Get all background processes for the current user.
   *
   * Delegates to TranscriptionJobService with optional filtering
   * by status, consultation, and pagination.
   *
   * @param userId - Authenticated user ID
   * @param filters - Optional status, consultation, and pagination filters
   * @param workspaceId - Tenant workspace ID
   * @returns Paginated list of background transcription processes
   */
  async getUserBackgroundProcesses(
    userId: string,
    filters: any,
    workspaceId: string,
  ): Promise<any> {
    return this.transcriptionJobService.getUserTranscriptions(
      userId,
      workspaceId,
      filters,
    );
  }

  /**
   * Cancel a background transcription process.
   *
   * Delegates to TranscriptionJobService. Only cancellable if
   * not in a terminal state (PENDING_NOTE_GENERATION, NOTE_GENERATED, FAILED, CANCELLED).
   *
   * @param processId - Background transcription process ID
   * @param userId - Authenticated user ID
   * @param workspaceId - Tenant workspace ID
   * @returns Success status and message
   */
  async cancelBackgroundProcess(
    processId: string,
    userId: string,
    workspaceId: string,
  ): Promise<any> {
    return this.transcriptionJobService.cancelTranscription(
      processId,
      userId,
      workspaceId,
    );
  }

  /**
   * Get completed transcript from a background process.
   *
   * Delegates to TranscriptionJobService. Only works for processes
   * that have completed transcription (PENDING_NOTE_GENERATION or NOTE_GENERATED).
   *
   * @param processId - Background transcription process ID
   * @param userId - Authenticated user ID
   * @param workspaceId - Tenant workspace ID
   * @returns Transcript DTO from completed background process
   */
  async getCompletedTranscript(
    processId: string,
    userId: string,
    workspaceId: string,
  ): Promise<any> {
    return this.transcriptionJobService.getCompletedTranscriptOnly(
      processId,
      userId,
      workspaceId,
    );
  }

  /**
   * Generate a medical note from manual content input (no audio).
   *
   * Delegates to generateAndSaveNoteFromContent for the actual AI generation
   * and persistence logic.
   *
   * @param dto - Note generation configuration
   * @param userId - Authenticated user ID
   * @param workspaceId - Tenant workspace ID
   * @returns Generated care note
   */
  async generateNote(
    dto: GenerateNoteDto,
    userId: string,
    workspaceId: string,
  ): Promise<CareNoteResponseDto> {
    this.logger.log(
      `Generating note: consultation=${dto.consultationId}, type=${dto.noteType}`,
    );

    if (!dto.content || dto.content.trim().length === 0) {
      throw new BadRequestException(
        'Content is required for note generation',
      );
    }

    if (!dto.consultationId) {
      throw new BadRequestException(
        'Consultation ID is required for note generation',
      );
    }

    try {
      const savedNote = await this.generateAndSaveNoteFromContent({
        consultationId: dto.consultationId,
        content: dto.content,
        noteType: dto.noteType,
        userId,
        workspaceId,
        templateId: dto.templateId,
        provider: dto.provider,
        model: dto.model,
        temperature: dto.temperature,
        maxTokens: dto.maxTokens,
        title: dto.title,
        patientId: dto.patientId,
        existingNoteId: dto.existingNoteId,
        sourceContent: dto.content,
      });

      return this.careNotesService.mapToResponse(savedNote, userId);
    } catch (error) {
      this.logger.error(
        `Failed to generate note: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Regenerate an existing note with new AI processing.
   *
   * Creates a version snapshot of the current note before regeneration,
   * retrieves source content, and generates a new version.
   *
   * @param noteId - ID of the note to regenerate
   * @param dto - Regeneration configuration
   * @param userId - Authenticated user ID
   * @param workspaceId - Tenant workspace ID
   * @returns Regenerated care note
   */
  async regenerateNote(
    noteId: string,
    dto: RegenerateNoteDto,
    userId: string,
    workspaceId: string,
  ): Promise<any> {
    this.logger.log(`Regenerating note: ${noteId}`);

    // ── Phase 1: Short pre-generation transaction ─────────────────────────
    // Validate the note, resolve source content, create a version snapshot,
    // and capture the current version number for optimistic locking.
    // Commit immediately so the DB connection is freed before the AI call.
    let sourceContent: string;
    let noteType: CareNoteType;
    let expectedVersion: number;
    let snapshotVersionNumber: number;

    const qr1 = this.dataSource.createQueryRunner();
    await qr1.connect();
    await qr1.startTransaction();

    try {
      const existingNote = await qr1.manager.findOne(CareNote, {
        where: { id: noteId, workspaceId, deletedAt: IsNull() },
      });

      if (!existingNote) {
        throw new NotFoundException(`Note not found: ${noteId}`);
      }

      if (existingNote.authorId !== userId) {
        throw new ForbiddenException('Only the note author can regenerate a note');
      }

      // Capture current version for optimistic locking in Phase 3
      expectedVersion = existingNote.version || 1;
      noteType = dto.noteType || existingNote.type;

      // Resolve source content — priority:
      // 1. User-supplied edited content (dto.content) — source of truth in edit flow
      // 2. Latest ai_note_source.sourceContent — used when regenerating without edits
      // 3. Existing note content — last resort fallback
      sourceContent = '';

      if (dto.content && dto.content.trim()) {
        sourceContent = dto.content.trim();
      } else {
        const aiSources = await qr1.manager.find(CareAiNoteSource, {
          where: { noteId, workspaceId, deletedAt: IsNull() },
          order: { createdAt: 'DESC' },
          take: 1,
        });

        if (aiSources.length > 0 && aiSources[0].sourceContent) {
          sourceContent = aiSources[0].sourceContent;
        } else if (existingNote.content) {
          sourceContent =
            typeof existingNote.content === 'string'
              ? existingNote.content
              : JSON.stringify(existingNote.content);
        }
      }

      if (!sourceContent) {
        throw new BadRequestException(
          'No source content available for regeneration. Cannot regenerate note without source material.',
        );
      }

      // Create version snapshot before regeneration
      const versionSnapshot = this.createVersionSnapshot(existingNote);
      versionSnapshot.workspaceId = workspaceId;
      versionSnapshot.createdBy = userId;
      versionSnapshot.changeDescription = dto.reason || 'Pre-regeneration snapshot';
      const savedSnapshot = await qr1.manager.save(NoteVersion, versionSnapshot);
      snapshotVersionNumber = savedSnapshot.versionNumber;

      await qr1.commitTransaction();
    } catch (error) {
      await qr1.rollbackTransaction();
      throw error;
    } finally {
      await qr1.release();
    }

    // ── Phase 2: AI generation (no open transaction) ──────────────────────
    // The DB connection is fully released. AI calls can take 5–30 seconds
    // without holding a connection or blocking other queries.
    const generatedContent = await this.generateNoteContent({
      content: sourceContent,
      noteType,
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
    });

    const structuredContent = this.validateAndStructureNoteContent(
      generatedContent,
      noteType,
    );

    // ── Phase 3: Short commit transaction ─────────────────────────────────
    // Re-read the note filtering on the version captured in Phase 1.
    // If the row is gone or version has changed, a concurrent write happened —
    // throw ConflictException so the client can reload and retry.
    const qr3 = this.dataSource.createQueryRunner();
    await qr3.connect();
    await qr3.startTransaction();

    try {
      const noteToUpdate = await qr3.manager.findOne(CareNote, {
        where: { id: noteId, workspaceId, version: expectedVersion, deletedAt: IsNull() },
      });

      if (!noteToUpdate) {
        throw new ConflictException(
          'Note was modified concurrently. Please reload and try again.',
        );
      }

      noteToUpdate.content = JSON.stringify(structuredContent);
      noteToUpdate.type = noteType;
      noteToUpdate.status = CareNoteStatus.DRAFT;
      noteToUpdate.isAiGenerated = true;
      noteToUpdate.aiMetadata = {
        ...noteToUpdate.aiMetadata,
        provider: dto.provider || this.getBestAvailableProvider(),
        model: dto.model || this.getDefaultModel(dto.provider),
        temperature: dto.temperature ?? 0.7,
        regeneratedAt: new Date(),
        regenerationReason: dto.reason,
        previousVersion: expectedVersion,
      };
      noteToUpdate.version = expectedVersion + 1;
      noteToUpdate.isLatestVersion = true;

      const updatedNote = await qr3.manager.save(CareNote, noteToUpdate);

      // Create new AI source record
      const aiSource = qr3.manager.create(CareAiNoteSource, {
        id: uuidv4(),
        workspaceId,
        noteId: updatedNote.id,
        aiProvider: dto.provider || this.getBestAvailableProvider(),
        sourceType: 'regeneration',
        sourceContent,
        modelVersion: dto.model || this.getDefaultModel(dto.provider),
        processedAt: new Date(),
        processingMetadata: {
          temperature: dto.temperature ?? 0.7,
          reason: dto.reason,
          previousVersion: snapshotVersionNumber,
        },
      });
      await qr3.manager.save(CareAiNoteSource, aiSource);

      await qr3.commitTransaction();

      this.logger.log(
        `Note regenerated successfully: ${noteId}, new version=${updatedNote.version}`,
      );

      // Audit log (outside transaction)
      await this.safeAuditLog(
        {
          userId,
          action: 'regenerateNote',
          eventType: AuditEventType.UPDATE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'CareNote',
          resourceId: noteId,
          metadata: {
            action: NoteAuditActionType.AI_GENERATE,
            noteType,
            reason: dto.reason,
            newVersion: updatedNote.version,
          },
        },
        workspaceId,
      );

      return updatedNote;
    } catch (error) {
      await qr3.rollbackTransaction();
      this.logger.error(
        `Failed to commit regenerated note ${noteId}: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      await qr3.release();
    }
  }

  /**
   * Get all transcripts with pagination and filtering.
   *
   * Supports filtering by provider, model, search text, doctor, and date range.
   * Results are scoped to the workspace and optionally filtered by doctor (security).
   *
   * @param query - Filter and pagination parameters
   * @param userId - Authenticated user ID
   * @param workspaceId - Tenant workspace ID
   * @returns Paginated transcript list with metadata
   */
  async getAllTranscripts(
    query: TranscriptQueryDto,
    userId: string,
    workspaceId: string,
  ): Promise<any> {
    this.logger.debug('Getting all transcripts with filters');

    try {
      const page = query.page || 1;
      const limit = query.limit || 20;

      const queryBuilder = this.transcriptRepository
        .createQueryBuilder('transcript')
        .where('transcript.workspaceId = :workspaceId', { workspaceId });

      // Filter by provider
      if (query.provider) {
        queryBuilder.andWhere('transcript.aiProvider = :provider', {
          provider: query.provider,
        });
      }

      // Filter by model
      if (query.model) {
        queryBuilder.andWhere('transcript.modelUsed = :model', {
          model: query.model,
        });
      }

      // Filter by doctor (security: restrict non-admins to their own transcripts)
      if (query.doctorId) {
        queryBuilder.andWhere('transcript.doctorId = :doctorId', {
          doctorId: query.doctorId,
        });
      }

      // Filter by consultation
      if (query.consultationId) {
        queryBuilder.andWhere('transcript.consultationId = :consultationId', {
          consultationId: query.consultationId,
        });
      }

      // Full-text search on transcribed text
      if (query.search) {
        queryBuilder.andWhere(
          'transcript.transcribedText LIKE :search',
          { search: `%${query.search}%` },
        );
      }

      // Date range filters
      if (query.dateFrom) {
        queryBuilder.andWhere('transcript.createdAt >= :dateFrom', {
          dateFrom: new Date(query.dateFrom),
        });
      }

      if (query.dateTo) {
        queryBuilder.andWhere('transcript.createdAt <= :dateTo', {
          dateTo: new Date(query.dateTo),
        });
      }

      // Sorting
      const sortBy = query.sortBy || 'createdAt';
      const sortOrder = query.sortOrder || 'DESC';
      queryBuilder.orderBy(`transcript.${sortBy}`, sortOrder);

      // Pagination
      const skip = (page - 1) * limit;
      queryBuilder.skip(skip).take(limit);

      const [transcripts, total] = await queryBuilder.getManyAndCount();

      const data = transcripts.map((t) => this.mapToTranscriptDto(t));
      const totalPages = Math.ceil(total / limit);

      return {
        data,
        meta: {
          total,
          page,
          limit,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to get transcripts: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get a single transcript by ID with relations.
   *
   * @param transcriptId - Transcript ID
   * @param userId - Authenticated user ID
   * @param workspaceId - Tenant workspace ID
   * @returns Transcript with full details
   */
  async getTranscriptById(
    transcriptId: string,
    userId: string,
    workspaceId: string,
  ): Promise<any> {
    this.logger.debug(`Getting transcript: ${transcriptId}`);

    const transcript = await this.transcriptRepository.findOne({
      where: { id: transcriptId, workspaceId },
    });

    if (!transcript) {
      throw new NotFoundException(`Transcript not found: ${transcriptId}`);
    }

    return this.mapToTranscriptDto(transcript);
  }

  /**
   * Get transcripts for a specific consultation.
   *
   * @param consultationId - Consultation ID
   * @param query - Pagination parameters
   * @param userId - Authenticated user ID
   * @param workspaceId - Tenant workspace ID
   * @returns Paginated transcript list
   */
  async getConsultationTranscripts(
    consultationId: string,
    query: TranscriptQueryDto,
    userId: string,
    workspaceId: string,
  ): Promise<any> {
    this.logger.debug(
      `Getting transcripts for consultation: ${consultationId}`,
    );

    // TODO: Verify consultation access when cross-domain ConsultationService is available
    // await this.consultationService.verifyConsultationAccess(consultationId, userId, workspaceId);

    const page = query.page || 1;
    const limit = query.limit || 20;

    const [transcripts, total] = await this.transcriptRepository.findByConsultation(
      consultationId,
      workspaceId,
      page,
      limit,
    );

    const data = transcripts.map((t) => this.mapToTranscriptDto(t));
    const totalPages = Math.ceil(total / limit);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  /**
   * Soft-delete a transcript with version snapshot.
   *
   * Checks for associated notes, creates a version snapshot before deletion,
   * and logs the operation for audit compliance.
   *
   * @param transcriptId - Transcript ID to delete
   * @param userId - Authenticated user ID
   * @param workspaceId - Tenant workspace ID
   */
  async deleteTranscript(
    transcriptId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    this.logger.log(`Deleting transcript: ${transcriptId}`);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const transcript = await queryRunner.manager.findOne(RecordingsTranscript, {
        where: { id: transcriptId, workspaceId },
      });

      if (!transcript) {
        throw new NotFoundException(`Transcript not found: ${transcriptId}`);
      }

      // Security: verify the user owns the transcript
      if (transcript.doctorId !== userId) {
        throw new ForbiddenException(
          'Only the transcript owner can delete it',
        );
      }

      // Check for associated notes
      const associatedNotes = await queryRunner.manager.find(CareNote, {
        where: {
          recordingsTranscriptId: transcriptId,
          workspaceId,
          deletedAt: IsNull(),
        },
      });

      if (associatedNotes.length > 0) {
        this.logger.warn(
          `Transcript ${transcriptId} has ${associatedNotes.length} associated notes`,
        );
      }

      // Soft delete
      await queryRunner.manager.softDelete(RecordingsTranscript, {
        id: transcriptId,
        workspaceId,
      });

      await queryRunner.commitTransaction();

      this.logger.log(`Transcript deleted successfully: ${transcriptId}`);

      // Audit log
      await this.safeAuditLog({
        userId,
        action: 'deleteTranscript',
        eventType: AuditEventType.DELETE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'RecordingsTranscript',
        resourceId: transcriptId,
        metadata: {
          action: NoteAuditActionType.DELETE,
          consultationId: transcript.consultationId,
          associatedNoteCount: associatedNotes.length,
        },
      }, workspaceId);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Failed to delete transcript ${transcriptId}: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Approve or reject an AI-generated note.
   *
   * Verifies the note is AI-generated and the user has authority to approve/reject.
   * Creates a version snapshot and updates status accordingly.
   *
   * @param noteId - Note ID to approve/reject
   * @param dto - Approval/rejection configuration
   * @param userId - Authenticated user ID
   * @param workspaceId - Tenant workspace ID
   * @returns Updated care note
   */
  async approveAiNote(
    noteId: string,
    dto: ApproveAiNoteDto,
    userId: string,
    workspaceId: string,
  ): Promise<any> {
    this.logger.log(`${dto.action === 'approve' ? 'Approving' : 'Rejecting'} AI note: ${noteId}`);

    const note = await this.careNoteRepository.findOne({
      where: { id: noteId, workspaceId, deletedAt: IsNull() },
    });

    if (!note) {
      throw new NotFoundException(`Note not found: ${noteId}`);
    }

    if (!note.isAiGenerated) {
      throw new BadRequestException(
        'Only AI-generated notes can be approved or rejected through this workflow',
      );
    }

    if (note.status !== CareNoteStatus.DRAFT && note.status !== CareNoteStatus.PENDING_APPROVAL) {
      throw new ConflictException(
        `Note cannot be ${dto.action}d in its current status: ${note.status}`,
      );
    }

    // Verify the user is the note author (doctor who requested AI generation)
    if (note.authorId !== userId) {
      throw new ForbiddenException(
        'Only the note author can approve or reject an AI-generated note',
      );
    }

    try {
      // Create version snapshot before status change
      const versionSnapshot = this.createVersionSnapshot(note);
      versionSnapshot.workspaceId = workspaceId;
      versionSnapshot.createdBy = userId;
      versionSnapshot.changeDescription = `Pre-${dto.action} snapshot`;
      await this.careNoteRepository.manager.save(NoteVersion, versionSnapshot);

      // Apply modifications if any
      if (dto.action === 'approve' && dto.modifications) {
        const currentContent = typeof note.content === 'string'
          ? JSON.parse(note.content)
          : note.content || {};

        const mergedContent = { ...currentContent, ...dto.modifications };

        // Normalize: the frontend form produces nested wrapper objects
        // (e.g. management: { managementPlan: "..." }) alongside the flat keys.
        // Unwrap them and remove the wrappers so the saved content is clean.
        this.normalizeNoteContentWrappers(mergedContent);

        note.content = JSON.stringify(mergedContent);
      }

      // Update status
      if (dto.action === 'approve') {
        note.status = CareNoteStatus.PUBLISHED;
        note.aiMetadata = {
          ...note.aiMetadata,
          approvedBy: userId,
          approvedAt: new Date(),
          hasModifications: !!dto.modifications,
        };
      } else {
        note.status = CareNoteStatus.REJECTED;
        note.aiMetadata = {
          ...note.aiMetadata,
          rejectedBy: userId,
          rejectedAt: new Date(),
          rejectionReason: dto.reason,
        };
      }

      note.version = (note.version || 1) + 1;
      note.isLatestVersion = true;

      const updatedNote = await this.careNoteRepository.save(note);

      this.logger.log(
        `AI note ${dto.action}d successfully: ${noteId}`,
      );

      // On approval, dismiss the related transcription notification so the tray
      // clears automatically — the doctor has acted on the note.
      if (dto.action === 'approve' && note.consultationId) {
        await this.notificationsService.dismissByConsultationId(
          note.consultationId,
          userId,
          workspaceId,
        );
      }

      // Audit log
      const auditAction = dto.action === 'approve'
        ? NoteAuditActionType.AI_APPROVE
        : NoteAuditActionType.AI_REJECT;

      await this.safeAuditLog({
        userId,
        action: `${dto.action}AiNote`,
        eventType: AuditEventType.UPDATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'CareNote',
        resourceId: noteId,
        metadata: {
          action: auditAction,
          reason: dto.reason,
          hasModifications: !!dto.modifications,
        },
      }, workspaceId);

      return updatedNote;
    } catch (error) {
      this.logger.error(
        `Failed to ${dto.action} AI note ${noteId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Core note generation and persistence logic.
   *
   * Performs the full workflow within a transaction:
   * 1. Resolve template if provided
   * 2. Generate note content via AI strategy
   * 3. Validate and structure content per note type
   * 4. Create or update CareNote entity
   * 5. Create AI source tracking record
   * 6. Add to consultation timeline
   * 7. Audit log
   *
   * @param params - Generation parameters
   * @returns Saved care note entity
   */
  async generateAndSaveNoteFromContent(
    params: GenerateAndSaveNoteFromContentParams,
  ): Promise<any> {
    this.logger.log(
      `Generating and saving note: consultation=${params.consultationId}, type=${params.noteType}`,
    );

    // ── Phase 1 (update path only): Short pre-generation transaction ──────
    // For new notes there is nothing to lock.
    // For updates: find the note, create a version snapshot, and capture the
    // current version number so Phase 3 can detect concurrent modifications.
    let expectedVersion: number | undefined;
    let snapshotVersionNumber: number | undefined;

    if (params.existingNoteId) {
      const qr1 = this.dataSource.createQueryRunner();
      await qr1.connect();
      await qr1.startTransaction();

      try {
        const existingNote = await qr1.manager.findOne(CareNote, {
          where: {
            id: params.existingNoteId,
            workspaceId: params.workspaceId,
            deletedAt: IsNull(),
          },
        });

        if (!existingNote) {
          throw new NotFoundException(
            `Existing note not found: ${params.existingNoteId}`,
          );
        }

        expectedVersion = existingNote.version || 1;

        // Create version snapshot before AI generation
        const versionSnapshot = this.createVersionSnapshot(existingNote);
        versionSnapshot.workspaceId = params.workspaceId;
        versionSnapshot.createdBy = params.userId;
        versionSnapshot.changeDescription = 'Pre-AI-generation snapshot';
        const savedSnapshot = await qr1.manager.save(NoteVersion, versionSnapshot);
        snapshotVersionNumber = savedSnapshot.versionNumber;

        await qr1.commitTransaction();
      } catch (error) {
        await qr1.rollbackTransaction();
        throw error;
      } finally {
        await qr1.release();
      }
    }

    // ── Phase 2: Template resolution + AI generation (no open transaction) ─
    // The DB connection is fully released. Template lookup is fast; AI calls
    // can take 5–30 seconds without holding a connection or blocking queries.
    if (params.templateId) {
      try {
        await this.noteTemplateService.findOne(
          params.templateId,
          params.userId,
          params.workspaceId,
        );
      } catch (templateError) {
        this.logger.warn(
          `Template ${params.templateId} not found, proceeding without template`,
        );
      }
    }

    const startTime = Date.now();
    const generatedContent = await this.generateNoteContent({
      content: params.content,
      noteType: params.noteType,
      provider: params.provider,
      model: params.model,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      templateId: params.templateId,
    });
    const generationTime = Date.now() - startTime;

    const structuredContent = this.validateAndStructureNoteContent(
      generatedContent,
      params.noteType,
    );

    // ── Phase 3: Short commit transaction ─────────────────────────────────
    // For updates: re-read filtering on the version captured in Phase 1.
    // If the row is gone or version changed, a concurrent write happened —
    // throw ConflictException so the client can reload and retry.
    // For creates: insert note + AI source + timeline atomically.
    const resolvedProvider = params.provider || this.getBestAvailableProvider();
    const resolvedModel = params.model || this.getDefaultModel(params.provider);
    const noteTitle = params.title || this.generateDefaultTitle(params.noteType);

    // Snapshot the exact content the user sent for note generation.
    // Flow: audio → transcribe → structuredTranscript → user edits → sends
    // edited content as params.content.  params.content IS the AI input.
    const sourceTranscript = params.sourceContent || params.content || undefined;

    const qr3 = this.dataSource.createQueryRunner();
    await qr3.connect();
    await qr3.startTransaction();

    try {
      let savedNote: CareNote;
      let existingDraft: CareNote | null = null;

      if (params.existingNoteId) {
        // Optimistic lock check: re-read with the version captured in Phase 1
        const noteToUpdate = await qr3.manager.findOne(CareNote, {
          where: {
            id: params.existingNoteId,
            workspaceId: params.workspaceId,
            version: expectedVersion,
            deletedAt: IsNull(),
          },
        });

        if (!noteToUpdate) {
          throw new ConflictException(
            'Note was modified concurrently. Please reload and try again.',
          );
        }

        noteToUpdate.content = JSON.stringify(structuredContent);
        noteToUpdate.type = params.noteType;
        noteToUpdate.status = CareNoteStatus.DRAFT;
        noteToUpdate.isAiGenerated = true;
        noteToUpdate.aiMetadata = {
          provider: resolvedProvider,
          model: resolvedModel,
          temperature: params.temperature ?? 0.7,
          generationTimeMs: generationTime,
          timestamp: new Date(),
          transcriptId: params.transcriptId,
          sourceTranscript,
        };
        noteToUpdate.version = expectedVersion! + 1;
        noteToUpdate.isLatestVersion = true;

        savedNote = await qr3.manager.save(CareNote, noteToUpdate);
      } else {
        // ── Idempotency guard ──────────────────────────────────────────────
        // If a DRAFT note already exists for the same transcript + consultation
        // (e.g. from a timed-out previous generation), update it instead of
        // creating a duplicate.
        if (params.transcriptId && params.consultationId) {
          existingDraft = await qr3.manager.findOne(CareNote, {
            where: {
              workspaceId: params.workspaceId,
              consultationId: params.consultationId,
              recordingsTranscriptId: params.transcriptId,
              status: CareNoteStatus.DRAFT,
              isAiGenerated: true,
              isLatestVersion: true,
              deletedAt: IsNull(),
            },
          });
          if (existingDraft) {
            this.logger.log(
              `Idempotency: found existing DRAFT note ${existingDraft.id} for transcript=${params.transcriptId} — updating instead of creating`,
            );
          }
        }

        if (existingDraft) {
          // Update the existing draft with fresh AI content
          existingDraft.content = JSON.stringify(structuredContent);
          existingDraft.type = params.noteType;
          existingDraft.isAiGenerated = true;
          existingDraft.aiMetadata = {
            provider: resolvedProvider,
            model: resolvedModel,
            temperature: params.temperature ?? 0.7,
            generationTimeMs: generationTime,
            timestamp: new Date(),
            transcriptId: params.transcriptId,
            sourceTranscript,
          };
          existingDraft.version = (existingDraft.version || 1) + 1;
          existingDraft.isLatestVersion = true;

          savedNote = await qr3.manager.save(CareNote, existingDraft);
        } else {
          // Create new note
          const newNote = qr3.manager.create(CareNote, {
            id: uuidv4(),
            workspaceId: params.workspaceId,
            consultationId: params.consultationId,
            authorId: params.userId,
            type: params.noteType,
            status: CareNoteStatus.DRAFT,
            content: JSON.stringify(structuredContent),
            isAiGenerated: true,
            aiMetadata: {
              provider: resolvedProvider,
              model: resolvedModel,
              temperature: params.temperature ?? 0.7,
              generationTimeMs: generationTime,
              timestamp: new Date(),
              transcriptId: params.transcriptId,
              sourceTranscript,
            },
            version: 1,
            isLatestVersion: true,
            recordingsTranscriptId: params.transcriptId,
          });

          savedNote = await qr3.manager.save(CareNote, newNote);
        }
      }

      // Create AI source tracking record
      const aiSource = qr3.manager.create(CareAiNoteSource, {
        id: uuidv4(),
        workspaceId: params.workspaceId,
        noteId: savedNote.id,
        aiProvider: resolvedProvider,
        sourceType: params.transcriptId ? 'transcript' : 'manual_content',
        sourceId: params.transcriptId,
        sourceContent: params.sourceContent || params.content,
        modelVersion: resolvedModel,
        processedAt: new Date(),
        recordingTranscriptId: params.transcriptId,
        processingMetadata: {
          temperature: params.temperature ?? 0.7,
          maxTokens: params.maxTokens,
          generationTimeMs: generationTime,
          templateId: params.templateId,
          noteType: params.noteType,
        },
      });
      await qr3.manager.save(CareAiNoteSource, aiSource);

      // Add to consultation timeline (non-fatal)
      try {
        const { CareNoteTimeline } = await import('../entities/care-note-timeline.entity');
        const timelineRepository = qr3.manager.getRepository(CareNoteTimeline);

        const lastTimeline = await timelineRepository.findOne({
          where: {
            consultationId: params.consultationId,
            workspaceId: params.workspaceId,
          },
          order: { createdAt: 'DESC' },
        });

        const nextSequence = lastTimeline
          ? (lastTimeline as any).sequenceNumber + 1
          : 1;

        const timeline = timelineRepository.create({
          consultationId: params.consultationId,
          noteId: savedNote.id,
          workspaceId: params.workspaceId,
          eventType: `ai_note_generated_${params.noteType}`,
          eventTitle: `AI ${noteTitle} Generated`,
          eventDescription: `AI-generated ${params.noteType} note created using ${resolvedProvider}/${resolvedModel}`,
          eventTime: new Date(),
          createdBy: params.userId,
          metadata: {
            provider: resolvedProvider,
            model: resolvedModel,
            generationTimeMs: generationTime,
            sequenceNumber: nextSequence,
          },
        });

        await qr3.manager.save(timeline);
      } catch (timelineError) {
        this.logger.warn(`Failed to add timeline entry: ${timelineError.message}`);
      }

      await qr3.commitTransaction();

      this.logger.log(
        `Note generated and saved successfully: ${savedNote.id}, type=${params.noteType}`,
      );

      // Audit log (outside transaction)
      await this.safeAuditLog(
        {
          userId: params.userId,
          action: 'generateAndSaveNote',
          eventType: AuditEventType.CREATE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'CareNote',
          resourceId: savedNote.id,
          metadata: {
            action: NoteAuditActionType.AI_GENERATE,
            noteType: params.noteType,
            consultationId: params.consultationId,
            provider: resolvedProvider,
            model: resolvedModel,
            generationTimeMs: generationTime,
            isUpdate: !!params.existingNoteId || !!existingDraft,
          },
        },
        params.workspaceId,
      );

      return savedNote;
    } catch (error) {
      await qr3.rollbackTransaction();
      this.logger.error(
        `Failed to generate and save note: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      await qr3.release();
    }
  }

  /**
   * Get version history and audit logs for a transcript.
   *
   * @param transcriptId - Transcript ID
   * @param userId - Authenticated user ID
   * @param workspaceId - Tenant workspace ID
   * @returns Version history with audit trail
   */
  async getTranscriptHistory(
    transcriptId: string,
    userId: string,
    workspaceId: string,
  ): Promise<any> {
    this.logger.debug(`Getting transcript history: ${transcriptId}`);

    const transcript = await this.transcriptRepository.findOne({
      where: { id: transcriptId, workspaceId },
    });

    if (!transcript) {
      throw new NotFoundException(`Transcript not found: ${transcriptId}`);
    }

    // Get version history from NoteVersion table (used for transcript versions too)
    // We store transcript versions with a metadata flag to distinguish them
    const versions = await this.dataSource.manager.find(NoteVersion, {
      where: { noteId: transcriptId, workspaceId },
      order: { versionNumber: 'DESC' },
    });

    // Get audit logs for the transcript
    let auditLogs: any[] = [];
    try {
      auditLogs = await this.auditLogService.findByResource(
        'RecordingsTranscript',
        transcriptId,
        workspaceId,
      );
    } catch (auditError) {
      this.logger.warn(`Failed to retrieve audit logs for transcript: ${auditError.message}`);
    }

    return {
      transcriptId,
      currentVersion: this.mapToTranscriptDto(transcript),
      versions: versions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        content: v.content,
        createdBy: v.createdBy,
        changeDescription: v.changeDescription,
        metadata: v.metadata,
        createdAt: v.createdAt,
      })),
      auditLogs,
    };
  }

  /**
   * Update an existing transcript with new audio content.
   *
   * Creates a version snapshot, transcribes new audio, merges with existing
   * content based on strategy (append or replace), and generates a new
   * structured transcript.
   *
   * @param dto - Update configuration
   * @param filePath - Path to new audio file
   * @param userId - Authenticated user ID
   * @param workspaceId - Tenant workspace ID
   * @returns Updated transcript
   */
  async updateTranscriptWithAudio(
    dto: UpdateTranscriptWithAudioDto,
    filePath: string,
    userId: string,
    workspaceId: string,
  ): Promise<any> {
    // ── Path A: aiNoteSourceId — no existing transcript ──────────────────────
    // Transcribe audio, merge with care_ai_note_sources.sourceContent, and
    // create a brand-new RecordingsTranscript linked back to the source.
    if (dto.aiNoteSourceId && !dto.transcriptId) {
      return this._createTranscriptFromAiSource(dto, filePath, userId, workspaceId);
    }

    // ── Path B: transcriptId — update existing transcript ────────────────────
    this.logger.log(`Updating transcript with audio: ${dto.transcriptId}`);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Find existing transcript
      const existingTranscript = await queryRunner.manager.findOne(
        RecordingsTranscript,
        { where: { id: dto.transcriptId, workspaceId } },
      );

      if (!existingTranscript) {
        throw new NotFoundException(
          `Transcript not found: ${dto.transcriptId}`,
        );
      }

      // Transcribe new audio
      const transcriptionResult = await this.transcribeWithFallback(
        filePath,
        uuidv4(),
        dto.language,
        dto.provider,
      );

      if (!transcriptionResult || !transcriptionResult.text) {
        throw new BadRequestException(
          'New audio transcription returned empty result',
        );
      }

      // Merge with existing content based on strategy
      let mergedText: string;
      const strategy = dto.mergeStrategy || 'append';

      if (strategy === 'replace') {
        mergedText = await this.replaceTranscript(
          existingTranscript.transcribedText,
          transcriptionResult.text,
          dto.context,
          dto.model,
          dto.temperature,
        );
      } else {
        mergedText = await this.appendToTranscript(
          existingTranscript.transcribedText,
          transcriptionResult.text,
          dto.context,
          dto.model,
          dto.temperature,
        );
      }

      // Update transcript with merged content
      existingTranscript.transcribedText = mergedText;
      existingTranscript.audioFilePath = filePath;
      existingTranscript.aiProvider = transcriptionResult.provider;
      existingTranscript.modelUsed = transcriptionResult.model;

      // Generate new structured transcript
      const temperature = dto.temperature ?? 0.7;
      const model = dto.model || this.getDefaultModel(transcriptionResult.provider);

      try {
        const strategy = await this.aiStrategyFactory.getStrategy(
          transcriptionResult.provider,
        );
        const structuredResult = await strategy.generateStructuredTranscript(
          mergedText,
          temperature,
          model,
          dto.context || '',
        );

        if (structuredResult?.choices?.[0]?.message?.content) {
          existingTranscript.structuredTranscript = this.cleanContent(
            structuredResult.choices[0].message.content,
          );
        }
      } catch (structuredError) {
        this.logger.warn(
          `Failed to generate structured transcript for update: ${structuredError.message}`,
        );
        existingTranscript.structuredTranscript = mergedText;
      }

      const updatedTranscript = await queryRunner.manager.save(
        RecordingsTranscript,
        existingTranscript,
      );

      await queryRunner.commitTransaction();

      this.logger.log(
        `Transcript updated with audio successfully: ${dto.transcriptId}`,
      );

      // Audit log
      await this.safeAuditLog({
        userId,
        action: 'updateTranscriptWithAudio',
        eventType: AuditEventType.UPDATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'RecordingsTranscript',
        resourceId: dto.transcriptId,
        metadata: {
          action: NoteAuditActionType.UPDATE,
          mergeStrategy: strategy,
          provider: transcriptionResult.provider,
          model: transcriptionResult.model,
        },
      }, workspaceId);

      // Return the saved transcript plus the raw new-audio transcription so the
      // caller can always inspect what the new audio resolved to, even when the
      // smart-merge determined nothing genuinely new needed to be appended.
      return {
        ...this.mapToTranscriptDto(updatedTranscript),
        rawTranscription: transcriptionResult.text,
        mergeStrategy: strategy,
        transcriptionProvider: transcriptionResult.provider,
        transcriptionModel: transcriptionResult.model,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Failed to update transcript with audio: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Create a new RecordingsTranscript by transcribing audio and merging with
   * an existing CareAiNoteSource.sourceContent.
   *
   * Called by updateTranscriptWithAudio when aiNoteSourceId is supplied
   * instead of transcriptId (i.e. the note has no linked transcript yet).
   */
  private async _createTranscriptFromAiSource(
    dto: UpdateTranscriptWithAudioDto,
    filePath: string,
    userId: string,
    workspaceId: string,
  ): Promise<any> {
    this.logger.log(`Creating transcript from ai note source: ${dto.aiNoteSourceId}`);

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      // 1. Load ai_note_source
      const aiSource = await qr.manager.findOne(CareAiNoteSource, {
        where: { id: dto.aiNoteSourceId, workspaceId, deletedAt: IsNull() },
      });
      if (!aiSource) {
        throw new NotFoundException(`AI note source not found: ${dto.aiNoteSourceId}`);
      }

      // 2. Resolve consultationId from linked note
      const note = await qr.manager.findOne(CareNote, {
        where: { id: aiSource.noteId, workspaceId },
      });
      const consultationId = note?.consultationId ?? dto.consultationId;
      if (!consultationId) {
        throw new BadRequestException(
          'Could not resolve consultationId for transcript creation',
        );
      }

      // 3. Transcribe new audio (outside transaction is preferred but kept here
      //    for atomicity with the subsequent save; audio transcription is fast
      //    relative to LLM structuring which is skipped on this path).
      const transcriptionResult = await this.transcribeWithFallback(
        filePath,
        uuidv4(),
        dto.language,
        dto.provider,
      );
      if (!transcriptionResult?.text) {
        throw new BadRequestException('Audio transcription returned empty result');
      }

      // 4. AI-powered merge — same strategy as the transcriptId path.
      // aiSource.sourceContent is already a structured markdown note, but the
      // merge helpers (removeOverlappingContent, needsSmartAppend) work on raw
      // sentences.  Markdown tokens like "**Chief Complaint:**" and "- High fever"
      // don't match the equivalent plain-text sentences from the new transcription,
      // so deduplication silently fails and both blocks get concatenated.
      // Stripping markdown first gives sentence-level similarity the same plain
      // text on both sides — identical to how the transcriptId path works with
      // existingTranscript.transcribedText (which is always raw text).
      const existingContent = this.stripMarkdown(aiSource.sourceContent ?? '');
      const mergeStrategy = dto.mergeStrategy ?? 'append';
      let mergedText: string;
      if (mergeStrategy === 'replace') {
        mergedText = await this.replaceTranscript(
          existingContent,
          transcriptionResult.text,
          dto.context,
          dto.model,
          dto.temperature,
        );
      } else {
        mergedText = await this.appendToTranscript(
          existingContent,
          transcriptionResult.text,
          dto.context,
          dto.model,
          dto.temperature,
        );
      }

      // 5. Generate structured transcript (with fallback to merged text)
      const temperature = dto.temperature ?? 0.7;
      const model = dto.model || this.getDefaultModel(transcriptionResult.provider);
      let structuredText = mergedText;
      try {
        const strategyInstance = await this.aiStrategyFactory.getStrategy(
          transcriptionResult.provider,
        );
        const structuredResult = await strategyInstance.generateStructuredTranscript(
          mergedText,
          temperature,
          model,
          dto.context || '',
        );
        if (structuredResult?.choices?.[0]?.message?.content) {
          structuredText = this.cleanContent(
            structuredResult.choices[0].message.content,
          );
        }
      } catch (structuredError) {
        this.logger.warn(
          `Failed to generate structured transcript from ai source: ${structuredError.message}`,
        );
      }

      // 6. Create RecordingsTranscript with merged content
      const newTranscript = qr.manager.create(RecordingsTranscript, {
        id: uuidv4(),
        workspaceId,
        doctorId: userId,
        consultationId,
        transcribedText: mergedText,
        structuredTranscript: structuredText,
        audioFilePath: filePath,
        aiProvider: transcriptionResult.provider,
        modelUsed: transcriptionResult.model,
      });
      const savedTranscript = await qr.manager.save(RecordingsTranscript, newTranscript);

      // 7. Link the new transcript back to the ai_note_source
      aiSource.recordingTranscriptId = savedTranscript.id;
      await qr.manager.save(CareAiNoteSource, aiSource);

      await qr.commitTransaction();

      this.logger.log(
        `Transcript created from ai source successfully: ${savedTranscript.id}`,
      );

      await this.safeAuditLog(
        {
          userId,
          action: 'createTranscriptFromAiSource',
          eventType: AuditEventType.CREATE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'RecordingsTranscript',
          resourceId: savedTranscript.id,
          metadata: {
            aiNoteSourceId: dto.aiNoteSourceId,
            mergeStrategy,
            provider: transcriptionResult.provider,
            model: transcriptionResult.model,
          },
        },
        workspaceId,
      );

      return {
        ...this.mapToTranscriptDto(savedTranscript),
        rawTranscription: transcriptionResult.text,
        mergeStrategy,
        transcriptionProvider: transcriptionResult.provider,
        transcriptionModel: transcriptionResult.model,
      };
    } catch (error) {
      await qr.rollbackTransaction();
      this.logger.error(
        `Failed to create transcript from ai source: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      await qr.release();
    }
  }

  /**
   * Merge two transcripts into one.
   *
   * Creates version snapshots for both transcripts, merges based on strategy
   * (append, prepend, smart), and archives the secondary transcript.
   *
   * @param dto - Merge configuration
   * @param userId - Authenticated user ID
   * @param workspaceId - Tenant workspace ID
   * @returns Merged transcript
   */
  async mergeTranscripts(
    dto: MergeTranscriptsDto,
    userId: string,
    workspaceId: string,
  ): Promise<any> {
    this.logger.log(
      `Merging transcripts: primary=${dto.primaryTranscriptId}, secondary=${dto.secondaryTranscriptId}, strategy=${dto.strategy}`,
    );

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Find both transcripts
      const primary = await queryRunner.manager.findOne(RecordingsTranscript, {
        where: { id: dto.primaryTranscriptId, workspaceId },
      });

      const secondary = await queryRunner.manager.findOne(RecordingsTranscript, {
        where: { id: dto.secondaryTranscriptId, workspaceId },
      });

      if (!primary) {
        throw new NotFoundException(
          `Primary transcript not found: ${dto.primaryTranscriptId}`,
        );
      }

      if (!secondary) {
        throw new NotFoundException(
          `Secondary transcript not found: ${dto.secondaryTranscriptId}`,
        );
      }

      // Merge based on strategy
      const mergedText = await this.mergeTranscriptContent(
        primary.transcribedText,
        secondary.transcribedText,
        dto.strategy,
        dto.context,
        dto.model,
        dto.temperature,
      );

      // Update primary with merged content
      primary.transcribedText = mergedText;

      // Regenerate structured transcript for the merged content
      const model = dto.model || this.getDefaultModel(primary.aiProvider);
      const temperature = dto.temperature ?? 0.7;

      try {
        const strategyInstance = this.aiStrategyFactory.getStrategy(primary.aiProvider);
        const structuredResult = await strategyInstance.generateStructuredTranscript(
          mergedText,
          temperature,
          model,
          dto.context || '',
        );

        if (structuredResult?.choices?.[0]?.message?.content) {
          primary.structuredTranscript = this.cleanContent(
            structuredResult.choices[0].message.content,
          );
        }
      } catch (structuredError) {
        this.logger.warn(
          `Failed to generate structured transcript for merge: ${structuredError.message}`,
        );
        primary.structuredTranscript = mergedText;
      }

      const mergedTranscript = await queryRunner.manager.save(
        RecordingsTranscript,
        primary,
      );

      // Archive (soft delete) the secondary transcript
      await queryRunner.manager.softDelete(RecordingsTranscript, {
        id: dto.secondaryTranscriptId,
        workspaceId,
      });

      await queryRunner.commitTransaction();

      this.logger.log(
        `Transcripts merged successfully: result=${mergedTranscript.id}`,
      );

      // Audit log
      await this.safeAuditLog({
        userId,
        action: 'mergeTranscripts',
        eventType: AuditEventType.UPDATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'RecordingsTranscript',
        resourceId: dto.primaryTranscriptId,
        metadata: {
          action: NoteAuditActionType.UPDATE,
          secondaryTranscriptId: dto.secondaryTranscriptId,
          mergeStrategy: dto.strategy,
        },
      }, workspaceId);

      return this.mapToTranscriptDto(mergedTranscript);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Failed to merge transcripts: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Get a specific version of a transcript.
   *
   * @param transcriptId - Transcript ID
   * @param versionNumber - Version number to retrieve
   * @param userId - Authenticated user ID
   * @param workspaceId - Tenant workspace ID
   * @returns Version data
   */
  async getTranscriptVersion(
    transcriptId: string,
    versionNumber: number,
    userId: string,
    workspaceId: string,
  ): Promise<any> {
    this.logger.debug(
      `Getting transcript version: transcript=${transcriptId}, version=${versionNumber}`,
    );

    // Verify transcript exists
    const transcript = await this.transcriptRepository.findOne({
      where: { id: transcriptId, workspaceId },
    });

    if (!transcript) {
      throw new NotFoundException(`Transcript not found: ${transcriptId}`);
    }

    // Find the specific version (stored in NoteVersion with transcript ID as noteId)
    const version = await this.dataSource.manager.findOne(NoteVersion, {
      where: {
        noteId: transcriptId,
        versionNumber,
        workspaceId,
      },
    });

    if (!version) {
      throw new NotFoundException(
        `Version ${versionNumber} not found for transcript ${transcriptId}`,
      );
    }

    return {
      id: version.id,
      transcriptId,
      versionNumber: version.versionNumber,
      content: version.content,
      createdBy: version.createdBy,
      changeDescription: version.changeDescription,
      metadata: version.metadata,
      createdAt: version.createdAt,
    };
  }

  /**
   * Restore a transcript to a specific version.
   *
   * Creates a snapshot of the current state, then restores content from
   * the specified version.
   *
   * @param transcriptId - Transcript ID
   * @param versionNumber - Version number to restore
   * @param userId - Authenticated user ID
   * @param workspaceId - Tenant workspace ID
   * @returns Restored transcript
   */
  async restoreTranscriptVersion(
    transcriptId: string,
    versionNumber: number,
    userId: string,
    workspaceId: string,
  ): Promise<any> {
    this.logger.log(
      `Restoring transcript version: transcript=${transcriptId}, version=${versionNumber}`,
    );

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Find transcript
      const transcript = await queryRunner.manager.findOne(RecordingsTranscript, {
        where: { id: transcriptId, workspaceId },
      });

      if (!transcript) {
        throw new NotFoundException(`Transcript not found: ${transcriptId}`);
      }

      // Find the version to restore
      const versionToRestore = await queryRunner.manager.findOne(NoteVersion, {
        where: {
          noteId: transcriptId,
          versionNumber,
          workspaceId,
        },
      });

      if (!versionToRestore) {
        throw new NotFoundException(
          `Version ${versionNumber} not found for transcript ${transcriptId}`,
        );
      }

      // Restore content from version
      const versionContent = typeof versionToRestore.content === 'string'
        ? versionToRestore.content
        : JSON.stringify(versionToRestore.content);

      // Parse version content - it should contain transcribedText and structuredTranscript
      let parsedContent: any;
      try {
        parsedContent = JSON.parse(versionContent);
      } catch {
        parsedContent = { transcribedText: versionContent };
      }

      transcript.transcribedText = parsedContent.transcribedText || versionContent;
      transcript.structuredTranscript = parsedContent.structuredTranscript || transcript.structuredTranscript;

      const restoredTranscript = await queryRunner.manager.save(
        RecordingsTranscript,
        transcript,
      );

      await queryRunner.commitTransaction();

      this.logger.log(
        `Transcript version restored: transcript=${transcriptId}, version=${versionNumber}`,
      );

      // Audit log
      await this.safeAuditLog({
        userId,
        action: 'restoreTranscriptVersion',
        eventType: AuditEventType.UPDATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'RecordingsTranscript',
        resourceId: transcriptId,
        metadata: {
          action: NoteAuditActionType.VERSION_RESTORE,
          restoredVersion: versionNumber,
        },
      }, workspaceId);

      return this.mapToTranscriptDto(restoredTranscript);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Failed to restore transcript version: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Get AI source records for a specific note.
   *
   * Returns all AI generation source records associated with the note,
   * including provider details, source content, and processing metadata.
   *
   * @param noteId - Note ID
   * @param userId - Authenticated user ID
   * @param workspaceId - Tenant workspace ID
   * @returns Array of AI source records
   */
  async getAiSourcesForNote(
    noteId: string,
    userId: string,
    workspaceId: string,
  ): Promise<any[]> {
    this.logger.debug(`Getting AI sources for note: ${noteId}`);

    // Verify note exists and user has access
    const note = await this.careNoteRepository.findOne({
      where: { id: noteId, workspaceId, deletedAt: IsNull() },
    });

    if (!note) {
      throw new NotFoundException(`Note not found: ${noteId}`);
    }

    const sources = await this.dataSource.manager.find(CareAiNoteSource, {
      where: { noteId, workspaceId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });

    return sources.map((source) => ({
      id: source.id,
      noteId: source.noteId,
      provider: source.aiProvider,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceContent: source.sourceContent,
      modelVersion: source.modelVersion,
      confidenceScore: source.confidenceScore,
      processedAt: source.processedAt,
      processingMetadata: source.processingMetadata,
      recordingTranscriptId: source.recordingTranscriptId,
      createdAt: source.createdAt,
    }));
  }

  /**
   * Generate a structured transcript from raw transcription text.
   *
   * Processes raw text through AI to produce a structured medical transcript,
   * then persists it as a RecordingsTranscript entity.
   *
   * @param params - Generation parameters
   * @returns Saved transcript entity
   */
  async generateStructuredTranscript(
    params: GenerateStructuredTranscriptParams,
  ): Promise<RecordingsTranscript> {
    this.logger.log(
      `Generating structured transcript: consultation=${params.consultationId}`,
    );

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Clean the raw text
      const cleanedText = this.cleanContent(params.rawText);

      // Generate structured version via AI
      let structuredText = cleanedText;
      const temperature = params.temperature ?? 0.7;

      const strategy = this.aiStrategyFactory.getStrategy(params.provider);
      this.logger.debug(
        `Calling AI strategy.generateStructuredTranscript: provider=${params.provider}, model=${params.model}, textLen=${cleanedText.length}`,
      );
      const structuredResult = await strategy.generateStructuredTranscript(
        cleanedText,
        temperature,
        params.model,
        params.context || '',
      );

      if (structuredResult?.choices?.[0]?.message?.content) {
        structuredText = this.cleanContent(
          structuredResult.choices[0].message.content,
        );
        this.logger.log(
          `AI structured transcript generated successfully: outputLen=${structuredText.length}, finishReason=${structuredResult.choices[0].finish_reason}`,
        );
      } else {
        // Do NOT silently fall back — throw so the pipeline retry loop can handle it
        const choicesInfo = JSON.stringify(
          structuredResult?.choices?.map(c => ({
            finish_reason: c.finish_reason,
            hasContent: !!c.message?.content,
          })) ?? [],
        );
        this.logger.warn(
          `AI structured transcript response missing content — choices=${choicesInfo}`,
        );
        throw new Error(
          `AI structured transcript returned empty content (choices=${choicesInfo})`,
        );
      }

      // Create and save transcript entity
      const transcript = queryRunner.manager.create(RecordingsTranscript, {
        id: uuidv4(),
        workspaceId: params.workspaceId,
        doctorId: params.userId,
        consultationId: params.consultationId,
        transcribedText: cleanedText,
        audioFilePath: params.audioFilePath,
        structuredTranscript: structuredText,
        aiProvider: params.provider,
        modelUsed: params.model,
      });

      const savedTranscript = await queryRunner.manager.save(
        RecordingsTranscript,
        transcript,
      );

      await queryRunner.commitTransaction();

      this.logger.log(
        `Structured transcript generated: ${savedTranscript.id}`,
      );

      return savedTranscript;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Failed to generate structured transcript: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  /**
   * Transcribe audio with provider fallback.
   *
   * Tries the primary provider, falls back to alternatives if unhealthy.
   * Tracks provider health status for subsequent requests.
   *
   * @param filePath - Audio file path
   * @param sourceId - Source tracking ID
   * @param language - Audio language code
   * @param primaryProvider - Preferred AI provider
   * @returns Transcription result with provider metadata
   */
  private async transcribeWithFallback(
    filePath: string,
    sourceId: string,
    language?: string,
    primaryProvider?: AIProvider,
  ): Promise<{
    text: string;
    provider: AIProvider;
    model: string;
    sourceId: string;
  }> {
    this.logger.debug(
      `Transcribing with fallback: primaryProvider=${primaryProvider || 'default'}`,
    );

    try {
      // Use the factory's built-in fallback mechanism
      const {
        strategy,
        provider: resolvedProvider,
        isFallback,
      } = await this.aiStrategyFactory.getStrategyWithFallback(primaryProvider);

      if (isFallback) {
        this.logger.warn(
          `Using fallback provider ${resolvedProvider} for transcription`,
        );
        // Mark primary as unhealthy
        if (primaryProvider) {
          this.providerHealthStatus[primaryProvider] = false;
        }
      }

      const result = await strategy.transcribeAudio(filePath, language);

      // Mark provider as healthy on success
      this.providerHealthStatus[resolvedProvider] = true;

      return {
        text: result.text,
        provider: resolvedProvider,
        model: this.getDefaultModel(resolvedProvider),
        sourceId,
      };
    } catch (error) {
      this.logger.error(
        `All transcription providers failed: ${error.message}`,
        error.stack,
      );

      // Mark the primary provider as unhealthy
      if (primaryProvider) {
        this.providerHealthStatus[primaryProvider] = false;
      }

      throw new InternalServerErrorException(
        `Audio transcription failed across all providers: ${error.message}`,
      );
    }
  }

  /**
   * Generate note content via AI strategy.
   *
   * Delegates to the appropriate AI provider strategy to generate
   * structured medical note content.
   *
   * @param params - Generation parameters
   * @returns Raw generated content (typically a JSON object)
   */
  private async generateNoteContent(
    params: GenerateNoteContentParams,
  ): Promise<any> {
    this.logger.debug(
      `Generating note content: type=${params.noteType}, provider=${params.provider || 'default'}`,
    );

    const provider = params.provider || this.getBestAvailableProvider();

    try {
      const strategy = this.aiStrategyFactory.getStrategy(provider);

      const result = await strategy.generateNote({
        content: params.content,
        noteType: params.noteType,
        model: params.model || this.getDefaultModel(provider),
        temperature: params.temperature ?? 0.7,
        maxTokens: params.maxTokens || 2000,
      });

      this.providerHealthStatus[provider] = true;

      return result;
    } catch (error) {
      this.logger.error(
        `Note content generation failed with ${provider}: ${error.message}`,
        error.stack,
      );

      this.providerHealthStatus[provider] = false;

      // Try fallback provider
      const fallbackProvider = this.getFallbackModel(provider);
      if (fallbackProvider.provider !== provider) {
        this.logger.log(
          `Trying fallback provider ${fallbackProvider.provider} for note generation`,
        );

        try {
          const fallbackStrategy = this.aiStrategyFactory.getStrategy(
            fallbackProvider.provider,
          );

          const fallbackResult = await fallbackStrategy.generateNote({
            content: params.content,
            noteType: params.noteType,
            model: fallbackProvider.model,
            temperature: params.temperature ?? 0.7,
            maxTokens: params.maxTokens || 2000,
          });

          this.providerHealthStatus[fallbackProvider.provider] = true;

          return fallbackResult;
        } catch (fallbackError) {
          this.logger.error(
            `Fallback note generation also failed: ${fallbackError.message}`,
            fallbackError.stack,
          );
          this.providerHealthStatus[fallbackProvider.provider] = false;
        }
      }

      throw new InternalServerErrorException(
        `Note generation failed across providers: ${error.message}`,
      );
    }
  }

  /**
   * Validate and structure note content based on note type.
   *
   * Routes to the appropriate structuring method based on CareNoteType.
   *
   * @param content - Raw AI-generated content
   * @param noteType - Target note type
   * @returns Structured and validated note content
   */
  private validateAndStructureNoteContent(
    content: any,
    noteType: CareNoteType,
  ): any {
    if (!content || typeof content !== 'object') {
      this.logger.warn('Note content is not an object, wrapping in default structure');
      return {
        type: noteType,
        title: this.generateDefaultTitle(noteType),
        content: typeof content === 'string' ? content : JSON.stringify(content),
      };
    }

    // Ensure type field matches
    content.type = noteType;

    switch (noteType) {
      case CareNoteType.ADMISSION:
        return this.structureAdmissionNote(content);

      case CareNoteType.CONSULTATION:
        return this.structureConsultationNote(content);

      case CareNoteType.GENERAL_EXAMINATION:
        return this.structureGeneralExaminationNote(content);

      case CareNoteType.PROCEDURE:
        return this.structureProcedureNote(content);

      case CareNoteType.OPERATION:
        return this.structureOperationNote(content);

      case CareNoteType.ORTHOPEDIC_OPERATION:
        return this.structureOrthopedicsNote(content);

      case CareNoteType.PROGRESS:
        return this.structureProgressNote(content);

      case CareNoteType.DISCHARGE:
        return this.structureDischargeNote(content);

      case CareNoteType.EMERGENCY:
        return this.structureEmergencyNote(content);

      case CareNoteType.FOLLOW_UP:
        return this.structureFollowUpNote(content);

      default:
        this.logger.warn(`Unknown note type: ${noteType}, returning raw content`);
        return {
          type: noteType,
          title: this.generateDefaultTitle(noteType),
          ...content,
        };
    }
  }

  /**
   * Structure admission note content.
   */
  private structureAdmissionNote(content: any): IAdmissionNote {
    return {
      type: CareNoteType.ADMISSION,
      title: content.title || 'Admission Note',
      summary: content.summary,
      admissionReason: content.admissionReason || '',
      historyOfPresentIllness: content.historyOfPresentIllness || '',
      pastMedicalHistory: content.pastMedicalHistory || '',
      allergies: content.allergies || '',
      medications: content.medications || '',
      reviewOfSystems: content.reviewOfSystems || {
        sections: [],
        reviewedAndNegative: false,
      },
      physicalExam: content.physicalExam || {},
      assessment: this.structureAssessment(content.assessment),
      additionalNotes: content.additionalNotes,
    };
  }

  /**
   * Structure consultation note content.
   */
  private structureConsultationNote(content: any): IConsultationNote {
    return {
      type: CareNoteType.CONSULTATION,
      title: content.title || 'Consultation Note',
      summary: content.summary,
      chiefComplaint: {
        primary: content.chiefComplaint?.primary || content.chiefComplaint || '',
        duration: content.chiefComplaint?.duration || '',
        description: content.chiefComplaint?.description || '',
        onset: content.chiefComplaint?.onset,
        severity: this.ensureNumber(content.chiefComplaint?.severity),
      },
      historyOfPresentIllness: content.historyOfPresentIllness || '',
      reviewOfSystems: content.reviewOfSystems || {
        sections: [],
        reviewedAndNegative: false,
      },
      physicalExam: content.physicalExam || {},
      assessment: this.structureAssessment(content.assessment),
      additionalNotes: content.additionalNotes,
    };
  }

  /**
   * Structure general examination note content.
   */
  /**
   * Normalize note content by unwrapping nested wrapper objects that the frontend
   * form groups produce (e.g. management:{managementPlan}, additional:{additionalNotes},
   * history:{history}, etc.) and removing the wrapper keys.
   */
  private normalizeNoteContentWrappers(content: Record<string, any>): void {
    // Map of wrapper key → inner key → flat target key
    const wrapperMap: Array<[string, string, string]> = [
      ['management', 'managementPlan', 'managementPlan'],
      ['additional', 'additionalNotes', 'additionalNotes'],
    ];

    // Fields that should be plain strings but may be wrapped as { fieldName: "value" }
    const scalarFields = [
      'history', 'investigations', 'diagnosis',
      'managementPlan', 'additionalNotes', 'admittedTo', 'requestDoctor',
    ];

    // Unwrap scalar fields: { history: { history: "..." } } → { history: "..." }
    for (const field of scalarFields) {
      const val = content[field];
      if (val !== null && val !== undefined && typeof val === 'object' && !Array.isArray(val)) {
        const keys = Object.keys(val);
        if (keys.length === 1 && typeof val[keys[0]] === 'string') {
          content[field] = val[keys[0]];
        }
      }
    }

    // Lift nested wrapper keys and delete the wrapper
    for (const [wrapperKey, innerKey, targetKey] of wrapperMap) {
      if (content[wrapperKey] && typeof content[wrapperKey] === 'object') {
        // Prefer the flat value if it already exists; otherwise lift from wrapper
        if (!content[targetKey] && content[wrapperKey][innerKey]) {
          content[targetKey] = content[wrapperKey][innerKey];
        }
        delete content[wrapperKey];
      }
    }
  }

  private structureGeneralExaminationNote(content: any): IGeneralExaminationNote {
    // Normalize wrappers before reading fields (handles both AI generation & approval paths)
    this.normalizeNoteContentWrappers(content);

    // Process drug allergies
    const drugAllergies: IAllergyStructure[] = Array.isArray(content.drugAllergies)
      ? content.drugAllergies.map((allergy: any) => ({
          substance: allergy.substance || allergy.name || '',
          reaction: allergy.reaction || '',
          severity: (['Mild', 'Moderate', 'Severe', 'Life-threatening'].includes(allergy.severity)
            ? allergy.severity
            : 'Mild') as IAllergyStructure['severity'],
          onset: allergy.onset,
          notes: allergy.notes,
        }))
      : undefined;

    // Process current medications
    const medication: ITreatmentStructure[] | undefined = Array.isArray(content.medication)
      ? content.medication.map((med: any) => ({
          medicine: med.medicine || med.name || '',
          dose: med.dose || med.dosage || '',
          route: this.validateRoute(med.route) as ITreatmentStructure['route'],
          frequency: this.validateFrequency(med.frequency),
          days: med.days || '',
          instructions: med.instructions,
        }))
      : undefined;

    // Process treatment prescriptions
    let treatmentPrescriptions: IGeneralExaminationNote['treatmentPrescriptions'] | undefined;
    if (content.treatmentPrescriptions?.items && Array.isArray(content.treatmentPrescriptions.items)) {
      treatmentPrescriptions = {
        items: content.treatmentPrescriptions.items.map((item: any) => ({
          medicine: item.medicine || item.name || '',
          dose: item.dose || item.dosage || '',
          route: this.validateRoute(item.route) as ITreatmentStructure['route'],
          frequency: this.validateFrequency(item.frequency),
          days: item.days || '',
          instructions: item.instructions,
        })),
        additionalInstructions: content.treatmentPrescriptions.additionalInstructions,
      };
    }

    // Process procedures
    const procedures = Array.isArray(content.procedures)
      ? content.procedures.map((proc: any) => ({
          name: proc.name || '',
          description: proc.description,
        }))
      : undefined;

    return {
      type: CareNoteType.GENERAL_EXAMINATION,
      title: content.title || 'General Examination Note',
      summary: content.summary,
      drugAllergies,
      medication,
      history: content.history,
      examination: {
        bloodPressure: content.examination?.bloodPressure,
        heartRate: content.examination?.heartRate,
        temperature: content.examination?.temperature,
        gcs: content.examination?.gcs,
        respiratoryRate: content.examination?.respiratoryRate,
        oxygenSaturation: content.examination?.oxygenSaturation,
        bloodGlucose: content.examination?.bloodGlucose,
        weight: content.examination?.weight,
        height: content.examination?.height,
        caseExamination: content.examination?.caseExamination || '',
      },
      investigations: content.investigations,
      diagnosis: content.diagnosis,
      managementPlan: content.managementPlan || '',
      treatmentPrescriptions,
      procedures,
      admittedTo: content.admittedTo,
      requestDoctor: content.requestDoctor,
      additionalNotes: content.additionalNotes,
    };
  }

  /**
   * Structure procedure note content.
   */
  private structureProcedureNote(content: any): IProcedureNote {
    return {
      type: CareNoteType.PROCEDURE,
      title: content.title || 'Procedure Note',
      summary: content.summary,
      procedureName: content.procedureName || '',
      procedureCode: content.procedureCode,
      indications: content.indications || '',
      description: content.description || '',
      findings: content.findings || '',
      complications: content.complications || 'None',
      postProcedureInstructions: content.postProcedureInstructions || '',
      anesthesiaUsed: content.anesthesiaUsed,
      estimatedBloodLoss: content.estimatedBloodLoss,
      specimensTaken: Array.isArray(content.specimensTaken)
        ? content.specimensTaken
        : undefined,
      durationMinutes: this.ensureNumber(content.durationMinutes),
      equipmentUsed: Array.isArray(content.equipmentUsed)
        ? content.equipmentUsed
        : undefined,
      vitalSigns: content.vitalSigns,
      medicationsAdministered: Array.isArray(content.medicationsAdministered)
        ? content.medicationsAdministered.map((med: any) => ({
            name: med.name || '',
            dosage: med.dosage || med.dose || '',
            route: med.route || '',
            time: med.time || '',
            administeredBy: med.administeredBy,
          }))
        : undefined,
      additionalNotes: content.additionalNotes,
    };
  }

  /**
   * Structure operation note content.
   */
  private structureOperationNote(content: any): IOperationNote {
    return {
      type: CareNoteType.OPERATION,
      title: content.title || 'Operation Note',
      summary: content.summary,
      operationName: content.operationName || '',
      operationCode: content.operationCode,
      preoperativeDiagnosis: content.preoperativeDiagnosis || '',
      postoperativeDiagnosis: content.postoperativeDiagnosis || '',
      procedureDescription: content.procedureDescription || '',
      findings: content.findings || '',
      specimens: Array.isArray(content.specimens)
        ? content.specimens
        : [],
      estimatedBloodLoss: content.estimatedBloodLoss || '',
      complications: content.complications || 'None',
      surgicalTeam: Array.isArray(content.surgicalTeam)
        ? content.surgicalTeam.map((member: any) => ({
            role: member.role || 'Surgeon',
            providerId: member.providerId || '',
            name: member.name,
          }))
        : undefined,
      anesthesiaType: content.anesthesiaType,
      anesthesiaDuration: this.ensureNumber(content.anesthesiaDuration),
      surgicalApproach: content.surgicalApproach,
      drainsPlaced: content.drainsPlaced,
      closureTechnique: content.closureTechnique,
      implantsUsed: Array.isArray(content.implantsUsed)
        ? content.implantsUsed.map((implant: any) => ({
            name: implant.name || '',
            type: implant.type,
            lotNumber: implant.lotNumber,
            manufacturer: implant.manufacturer,
            model: implant.model,
            size: implant.size,
          }))
        : undefined,
      additionalNotes: content.additionalNotes,
    };
  }

  /**
   * Structure orthopedic operation note content.
   *
   * Extends the standard operation note with orthopedic-specific fields
   * like implants, bone graft, reduction quality, and antibiotic regimen.
   */
  private structureOrthopedicsNote(content: any): any {
    const baseOperation = this.structureOperationNote(content);

    return {
      ...baseOperation,
      type: CareNoteType.ORTHOPEDIC_OPERATION,
      title: content.title || 'Orthopedic Operation Note',
      laterality: content.laterality,
      approach: content.approach,
      implants: Array.isArray(content.implants)
        ? content.implants.map((implant: any) => ({
            type: implant.type || '',
            manufacturer: implant.manufacturer,
            model: implant.model,
            size: implant.size,
            lotNumber: implant.lotNumber,
            position: implant.position,
          }))
        : undefined,
      boneGraft: content.boneGraft
        ? {
            type: content.boneGraft.type || '',
            source: content.boneGraft.source,
            volume: content.boneGraft.volume,
          }
        : undefined,
      tourniquet: content.tourniquet
        ? {
            used: content.tourniquet.used ?? true,
            timeMinutes: content.tourniquet.timeMinutes,
            pressureMmHg: content.tourniquet.pressureMmHg,
          }
        : undefined,
      reductionQuality: content.reductionQuality,
      rangeOfMotion: content.rangeOfMotion
        ? {
            preOp: content.rangeOfMotion.preOp,
            postOp: content.rangeOfMotion.postOp,
          }
        : undefined,
      antibioticRegimen: content.antibioticRegimen
        ? {
            preoperative: content.antibioticRegimen.preoperative,
            postoperative: content.antibioticRegimen.postoperative,
          }
        : undefined,
      rehabProtocol: content.rehabProtocol
        ? {
            weightBearing: content.rehabProtocol.weightBearing,
            timeline: content.rehabProtocol.timeline,
          }
        : undefined,
      fluoroscopyShots: content.fluoroscopyShots,
      cArmTimeMinutes: content.cArmTimeMinutes,
    };
  }

  /**
   * Structure progress note content.
   */
  private structureProgressNote(content: any): IProgressNote {
    return {
      type: CareNoteType.PROGRESS,
      title: content.title || 'Progress Note',
      summary: content.summary,
      intervalHistory: content.intervalHistory || '',
      physicalExam: content.physicalExam || {},
      assessmentAndPlan: Array.isArray(content.assessmentAndPlan)
        ? content.assessmentAndPlan
        : [content.assessmentAndPlan || ''].filter(Boolean),
      additionalNotes: content.additionalNotes,
    };
  }

  /**
   * Structure discharge note content.
   */
  private structureDischargeNote(content: any): IDischargeNote {
    return {
      type: CareNoteType.DISCHARGE,
      title: content.title || 'Discharge Summary',
      summary: content.summary,
      dischargeDiagnosis: content.dischargeDiagnosis || '',
      hospitalCourse: content.hospitalCourse || '',
      dischargeMedications: Array.isArray(content.dischargeMedications)
        ? content.dischargeMedications
        : [],
      dischargeInstructions: content.dischargeInstructions || '',
      followUpPlan: content.followUpPlan || '',
      additionalNotes: content.additionalNotes,
    };
  }

  /**
   * Structure emergency note content.
   */
  private structureEmergencyNote(content: any): IEmergencyNote {
    return {
      type: CareNoteType.EMERGENCY,
      title: content.title || 'Emergency Department Note',
      summary: content.summary,
      chiefComplaint: {
        primary: content.chiefComplaint?.primary || content.chiefComplaint || '',
        duration: content.chiefComplaint?.duration || '',
        description: content.chiefComplaint?.description || '',
        onset: content.chiefComplaint?.onset,
        severity: this.ensureNumber(content.chiefComplaint?.severity),
      },
      historyOfPresentIllness: content.historyOfPresentIllness || '',
      physicalExam: content.physicalExam || {},
      emergencyAssessment: content.emergencyAssessment || '',
      emergencyPlan: content.emergencyPlan || '',
      triage: content.triage,
      additionalNotes: content.additionalNotes,
    };
  }

  /**
   * Structure follow-up note content.
   */
  private structureFollowUpNote(content: any): IFollowUpNote {
    return {
      type: CareNoteType.FOLLOW_UP,
      title: content.title || 'Follow-up Note',
      summary: content.summary,
      intervalHistory: content.intervalHistory || '',
      physicalExam: content.physicalExam || {},
      assessmentAndPlan: Array.isArray(content.assessmentAndPlan)
        ? content.assessmentAndPlan
        : [content.assessmentAndPlan || ''].filter(Boolean),
      complianceNotes: content.complianceNotes,
      additionalNotes: content.additionalNotes,
    };
  }

  /**
   * Structure assessment section with validated prescriptions.
   *
   * Normalizes medication routes and frequencies to standard abbreviations.
   */
  private structureAssessment(assessment: any): IAssessment {
    if (!assessment) {
      return {
        diagnosis: '',
        differentialDiagnosis: [],
        treatmentPlan: '',
      };
    }

    if (typeof assessment === 'string') {
      return {
        diagnosis: assessment,
        differentialDiagnosis: [],
        treatmentPlan: '',
      };
    }

    // Validate and structure prescriptions
    let prescription: ITreatmentStructure[] | undefined;
    if (Array.isArray(assessment.prescription)) {
      prescription = assessment.prescription.map((item: any) => ({
        medicine: item.medicine || item.name || '',
        dose: item.dose || item.dosage || '',
        route: this.validateRoute(item.route) as ITreatmentStructure['route'],
        frequency: this.validateFrequency(item.frequency),
        days: item.days || '',
        instructions: item.instructions,
        startDate: item.startDate,
        endDate: item.endDate,
      }));
    }

    return {
      diagnosis: assessment.diagnosis || '',
      differentialDiagnosis: Array.isArray(assessment.differentialDiagnosis)
        ? assessment.differentialDiagnosis
        : [],
      treatmentPlan: assessment.treatmentPlan || '',
      prescription,
    };
  }

  /**
   * Validate and normalize medication route to standard abbreviation.
   *
   * Accepted routes: PO (oral), IV (intravenous), IM (intramuscular),
   * SC (subcutaneous), Top (topical), INH (inhaled)
   *
   * @param route - Raw route string from AI output
   * @returns Normalized route string
   */
  private validateRoute(route: string): string {
    if (!route) return 'Oral';

    const normalized = route.trim().toUpperCase();

    const routeMap: Record<string, string> = {
      // Standard abbreviations
      PO: 'Oral',
      ORAL: 'Oral',
      'PER ORAL': 'Oral',
      'BY MOUTH': 'Oral',

      IV: 'IV',
      INTRAVENOUS: 'IV',
      'IV PUSH': 'IV',
      'IV BOLUS': 'IV',
      'IV INFUSION': 'IV',

      IM: 'IM',
      INTRAMUSCULAR: 'IM',

      SC: 'SC',
      SUBQ: 'SC',
      SUBCUTANEOUS: 'SC',
      'SUB-Q': 'SC',
      SQ: 'SC',

      TOP: 'Topical',
      TOPICAL: 'Topical',
      EXTERNAL: 'Topical',

      INH: 'Inhaled',
      INHALED: 'Inhaled',
      INHALATION: 'Inhaled',
      NEB: 'Inhaled',
      NEBULIZER: 'Inhaled',

      // Additional routes mapped to closest standard
      PR: 'Other',
      RECTAL: 'Other',
      'PER RECTAL': 'Other',
      SL: 'Other',
      SUBLINGUAL: 'Other',
      NGT: 'Other',
      NASAL: 'Other',
      OPHTHALMIC: 'Other',
      OTIC: 'Other',
      VAGINAL: 'Other',
      TRANSDERMAL: 'Topical',
    };

    return routeMap[normalized] || 'Other';
  }

  /**
   * Validate and normalize medication frequency to standard abbreviation.
   *
   * Accepted frequencies: OD, BD, TDS, QDS, Q4H, Q6H, Q8H, Q12H, PRN
   *
   * @param frequency - Raw frequency string from AI output
   * @returns Normalized frequency string
   */
  private validateFrequency(frequency: string): string {
    if (!frequency) return 'OD';

    const normalized = frequency.trim().toUpperCase();

    const frequencyMap: Record<string, string> = {
      // Standard abbreviations
      OD: 'OD',
      QD: 'OD',
      'ONCE DAILY': 'OD',
      'ONCE A DAY': 'OD',
      DAILY: 'OD',
      'Q24H': 'OD',

      BD: 'BD',
      BID: 'BD',
      'TWICE DAILY': 'BD',
      'TWICE A DAY': 'BD',
      'Q12H': 'Q12H',

      TDS: 'TDS',
      TID: 'TDS',
      'THREE TIMES DAILY': 'TDS',
      'THREE TIMES A DAY': 'TDS',
      'Q8H': 'Q8H',

      QDS: 'QDS',
      QID: 'QDS',
      'FOUR TIMES DAILY': 'QDS',
      'FOUR TIMES A DAY': 'QDS',
      'Q6H': 'Q6H',

      Q4H: 'Q4H',
      'EVERY 4 HOURS': 'Q4H',
      'EVERY FOUR HOURS': 'Q4H',

      'EVERY 6 HOURS': 'Q6H',
      'EVERY SIX HOURS': 'Q6H',

      'EVERY 8 HOURS': 'Q8H',
      'EVERY EIGHT HOURS': 'Q8H',

      'EVERY 12 HOURS': 'Q12H',
      'EVERY TWELVE HOURS': 'Q12H',

      PRN: 'PRN',
      'AS NEEDED': 'PRN',
      'WHEN NEEDED': 'PRN',
      'AS REQUIRED': 'PRN',

      STAT: 'STAT',
      IMMEDIATELY: 'STAT',
      NOW: 'STAT',

      // Additional frequencies
      NOCTE: 'NOCTE',
      'AT NIGHT': 'NOCTE',
      HS: 'NOCTE',
      'AT BEDTIME': 'NOCTE',

      MANE: 'MANE',
      'IN THE MORNING': 'MANE',
      AM: 'MANE',

      AC: 'AC',
      'BEFORE MEALS': 'AC',

      PC: 'PC',
      'AFTER MEALS': 'PC',

      WEEKLY: 'WEEKLY',
      'ONCE A WEEK': 'WEEKLY',
    };

    return frequencyMap[normalized] || frequency;
  }

  /**
   * Generate default title based on note type.
   *
   * @param noteType - CareNoteType enum value
   * @returns Human-readable title string
   */
  private generateDefaultTitle(noteType: CareNoteType): string {
    const titleMap: Record<CareNoteType, string> = {
      [CareNoteType.SOAP]: 'SOAP Note',
      [CareNoteType.ADMISSION]: 'Admission Note',
      [CareNoteType.CONSULTATION]: 'Consultation Note',
      [CareNoteType.GENERAL_EXAMINATION]: 'General Examination Note',
      [CareNoteType.PROCEDURE]: 'Procedure Note',
      [CareNoteType.OPERATION]: 'Operation Note',
      [CareNoteType.ORTHOPEDIC_OPERATION]: 'Orthopedic Operation Note',
      [CareNoteType.PROGRESS]: 'Progress Note',
      [CareNoteType.DISCHARGE]: 'Discharge Summary',
      [CareNoteType.EMERGENCY]: 'Emergency Department Note',
      [CareNoteType.FOLLOW_UP]: 'Follow-up Note',
    };

    return titleMap[noteType] || 'Medical Note';
  }

  /**
   * Create a version snapshot of the current note state.
   *
   * @param note - CareNote entity to snapshot
   * @returns NoteVersion entity (not yet persisted)
   */
  private createVersionSnapshot(note: CareNote): NoteVersion {
    const version = new NoteVersion();
    version.id = uuidv4();
    version.noteId = note.id;
    version.versionNumber = note.version || 1;
    version.content = typeof note.content === 'string'
      ? note.content
      : JSON.stringify(note.content || {});
    version.metadata = {
      type: note.type,
      status: note.status,
      isAiGenerated: note.isAiGenerated,
      aiMetadata: note.aiMetadata,
      snapshotAt: new Date(),
    };

    return version;
  }


  /**
   * Append new text to an existing transcript with intelligent merging.
   *
   * Determines if a simple append or AI-powered smart append is needed
   * based on content overlap analysis.
   *
   * @param existingText - Current transcript text
   * @param newText - New text to append
   * @param context - Optional context for AI merging
   * @param model - Optional AI model override
   * @param temperature - Optional temperature override
   * @returns Merged text
   */
  private async appendToTranscript(
    existingText: string,
    newText: string,
    context?: string,
    model?: string,
    temperature?: number,
  ): Promise<string> {
    if (!existingText) return newText;
    if (!newText) return existingText;

    // Step 1: Remove overlapping/duplicate sentences first (matches legacy order).
    // We pass the raw new text so only genuinely unique sentences are kept.
    const cleanedNew = this.removeOverlappingContent(existingText, newText);

    // Step 2: If context is supplied OR the cleaned text still has significant
    // overlap with the existing content, use AI for smart merging.
    // Fall back to context-free simple append when AI is unavailable.
    if (context || this.needsSmartAppend(existingText, cleanedNew)) {
      try {
        // Pass the *cleaned* (deduplicated) text to the AI so it doesn't
        // re-introduce duplicate sentences into the merged result.
        return await this.smartAppendWithAI(
          existingText,
          cleanedNew || newText, // keep raw fallback if everything was stripped
          context,
          model,
          temperature,
        );
      } catch (error) {
        this.logger.warn(
          `Smart append failed, falling back to simple append: ${error.message}`,
        );
      }
    }

    // Step 3: Simple separator-based append with deduplicated new content.
    return this.formatAppendedText(existingText, cleanedNew);
  }

  /**
   * Replace existing transcript with new text, preserving context.
   *
   * Optionally uses AI for context-aware replacement to maintain coherence.
   *
   * @param existingText - Current transcript text
   * @param newText - Replacement text
   * @param context - Optional context for AI replacement
   * @param model - Optional AI model override
   * @param temperature - Optional temperature override
   * @returns Replaced text
   */
  private async replaceTranscript(
    existingText: string,
    newText: string,
    context?: string,
    model?: string,
    temperature?: number,
  ): Promise<string> {
    if (!existingText) return newText;
    if (!newText) return existingText;

    // If context is provided, use context-aware replacement
    if (context) {
      try {
        return await this.contextAwareReplace(
          existingText,
          newText,
          context,
          model,
          temperature,
        );
      } catch (error) {
        this.logger.warn(
          `Context-aware replace failed, using direct replacement: ${error.message}`,
        );
      }
    }

    return newText;
  }

  /**
   * Merge transcript content based on strategy.
   *
   * @param primaryText - Primary transcript text
   * @param secondaryText - Secondary transcript text
   * @param strategy - Merge strategy (append, prepend, smart)
   * @param context - Optional merge context
   * @param model - Optional AI model override
   * @param temperature - Optional temperature override
   * @returns Merged text
   */
  private async mergeTranscriptContent(
    primaryText: string,
    secondaryText: string,
    strategy: 'append' | 'prepend' | 'smart',
    context?: string,
    model?: string,
    temperature?: number,
  ): Promise<string> {
    switch (strategy) {
      case 'append':
        return this.formatAppendedText(primaryText, secondaryText);

      case 'prepend':
        return this.formatAppendedText(secondaryText, primaryText);

      case 'smart':
        return this.smartMergeWithAI(
          primaryText,
          secondaryText,
          context,
          model,
          temperature,
        );

      default:
        return this.formatAppendedText(primaryText, secondaryText);
    }
  }

  /**
   * AI-powered smart merge of two text segments.
   *
   * Uses AI to intelligently combine two pieces of medical transcription,
   * removing duplicates and organizing content coherently.
   *
   * @param text1 - First text segment
   * @param text2 - Second text segment
   * @param context - Optional merge context
   * @param model - Optional AI model override
   * @param temperature - Optional temperature override
   * @returns Intelligently merged text
   */
  private async smartMergeWithAI(
    text1: string,
    text2: string,
    context?: string,
    model?: string,
    temperature?: number,
  ): Promise<string> {
    try {
      const provider = this.getBestAvailableProvider();
      const strategy = this.aiStrategyFactory.getStrategy(provider);
      const resolvedModel = model || this.getDefaultModel(provider);
      const resolvedTemp = temperature ?? 0.3;

      const mergePrompt = `You are a medical transcription specialist. Merge these two medical transcription segments into a single coherent transcript.

RULES:
1. Remove duplicate information
2. Maintain chronological order
3. Preserve all unique medical details
4. Do not add any new information
5. Keep medical terminology intact
6. Maintain speaker identification if present

Segment 1:
${text1}

Segment 2:
${text2}

${context ? `Context: ${context}` : ''}

Provide only the merged transcript text, no explanations or metadata.`;

      const result = await strategy.generateStructuredTranscript(
        mergePrompt,
        resolvedTemp,
        resolvedModel,
        'merge_transcripts',
      );

      if (result?.choices?.[0]?.message?.content) {
        return this.cleanContent(result.choices[0].message.content);
      }

      // Fallback to simple concatenation
      return this.formatAppendedText(text1, text2);
    } catch (error) {
      this.logger.warn(
        `Smart merge failed, using simple merge: ${error.message}`,
      );
      return this.formatAppendedText(text1, text2);
    }
  }

  /**
   * AI-powered smart append that handles overlapping content.
   *
   * @param existingText - Current transcript text
   * @param newText - New text to append
   * @param context - Optional context
   * @param model - Optional model override
   * @param temperature - Optional temperature override
   * @returns Intelligently appended text
   */
  private async smartAppendWithAI(
    existingText: string,
    newText: string,
    context?: string,
    model?: string,
    temperature?: number,
  ): Promise<string> {
    try {
      const provider = this.getBestAvailableProvider();
      const strategy = this.aiStrategyFactory.getStrategy(provider);
      const resolvedModel = model || this.getDefaultModel(provider);
      const resolvedTemp = temperature ?? 0.3;

      const appendPrompt = `You are a medical transcription specialist. Append the new transcription segment to the existing one, ensuring:
1. No duplicate content
2. Smooth transition between segments
3. All unique medical information is preserved
4. Chronological order is maintained

Existing transcript:
${existingText}

New segment to append:
${newText}

${context ? `Context: ${context}` : ''}

Provide only the combined transcript text, no explanations.`;

      const result = await strategy.generateStructuredTranscript(
        appendPrompt,
        resolvedTemp,
        resolvedModel,
        'append_transcript',
      );

      if (result?.choices?.[0]?.message?.content) {
        return this.cleanContent(result.choices[0].message.content);
      }

      return this.formatAppendedText(existingText, newText);
    } catch (error) {
      this.logger.warn(
        `Smart append failed: ${error.message}`,
      );
      return this.formatAppendedText(existingText, newText);
    }
  }

  /**
   * Context-aware replacement that preserves relevant portions.
   *
   * @param existingText - Current text
   * @param newText - Replacement text
   * @param context - Context for AI processing
   * @param model - Optional model override
   * @param temperature - Optional temperature override
   * @returns Context-aware replaced text
   */
  private async contextAwareReplace(
    existingText: string,
    newText: string,
    context: string,
    model?: string,
    temperature?: number,
  ): Promise<string> {
    try {
      const provider = this.getBestAvailableProvider();
      const strategy = this.aiStrategyFactory.getStrategy(provider);
      const resolvedModel = model || this.getDefaultModel(provider);
      const resolvedTemp = temperature ?? 0.3;

      const replacePrompt = `You are a medical transcription specialist. Replace the existing transcription with the new one, considering the provided context.

Context: ${context}

Existing transcript:
${existingText}

New replacement transcript:
${newText}

If there is relevant context-specific information in the existing transcript that is not in the new one, preserve it in an appropriate section. Otherwise, use the new transcript as the primary content.

Provide only the final transcript text, no explanations.`;

      const result = await strategy.generateStructuredTranscript(
        replacePrompt,
        resolvedTemp,
        resolvedModel,
        'replace_transcript',
      );

      if (result?.choices?.[0]?.message?.content) {
        return this.cleanContent(result.choices[0].message.content);
      }

      return newText;
    } catch (error) {
      this.logger.warn(
        `Context-aware replace failed: ${error.message}`,
      );
      return newText;
    }
  }

  /**
   * Remove overlapping content between existing and new text.
   *
   * Uses sentence-level comparison with Jaccard similarity scoring
   * to identify and remove duplicate sentences.
   *
   * @param existingText - Current transcript text
   * @param newText - New text to deduplicate
   * @returns New text with overlapping sentences removed
   */
  private removeOverlappingContent(existingText: string, newText: string): string {
    const existingSentences = this.splitIntoSentences(existingText);
    const newSentences = this.splitIntoSentences(newText);

    const uniqueSentences = newSentences.filter((newSentence) => {
      return !existingSentences.some((existingSentence) => {
        return this.similarityScore(newSentence, existingSentence) > 0.8;
      });
    });

    return uniqueSentences.join(' ').trim();
  }

  /**
   * Format text for appending with proper separation.
   *
   * @param existingText - Current text
   * @param newText - New text to append
   * @returns Formatted combined text
   */
  private formatAppendedText(existingText: string, newText: string): string {
    if (!existingText) return newText || '';
    if (!newText) return existingText || '';

    const separator = '\n\n--- Continuation ---\n\n';
    return `${existingText.trim()}${separator}${newText.trim()}`;
  }

  /**
   * Split text into sentences for comparison.
   *
   * @param text - Input text
   * @returns Array of sentences
   */
  private splitIntoSentences(text: string): string[] {
    if (!text) return [];

    return text
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  /**
   * Calculate Jaccard similarity score between two text strings.
   *
   * @param text1 - First text
   * @param text2 - Second text
   * @returns Similarity score (0-1)
   */
  private similarityScore(text1: string, text2: string): number {
    if (!text1 || !text2) return 0;

    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter((w) => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    if (union.size === 0) return 0;

    return intersection.size / union.size;
  }

  /**
   * Determine if AI-powered smart append is needed.
   *
   * Uses similarity analysis to detect significant overlap between texts.
   *
   * @param text1 - First text
   * @param text2 - Second text
   * @returns True if smart append is recommended
   */
  private needsSmartAppend(text1: string, text2: string): boolean {
    if (!text1 || !text2) return false;

    // Check for significant overlap
    const overallSimilarity = this.similarityScore(text1, text2);
    if (overallSimilarity > 0.3) return true;

    // Check last sentences of existing against first sentences of new
    const existingSentences = this.splitIntoSentences(text1);
    const newSentences = this.splitIntoSentences(text2);

    if (existingSentences.length === 0 || newSentences.length === 0) return false;

    // Check last 3 sentences of existing against first 3 of new
    const tailSentences = existingSentences.slice(-3);
    const headSentences = newSentences.slice(0, 3);

    for (const tail of tailSentences) {
      for (const head of headSentences) {
        if (this.similarityScore(tail, head) > 0.6) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Strip markdown formatting from text so that sentence-level similarity
   * helpers (removeOverlappingContent, needsSmartAppend) can compare plain
   * text on both sides of a merge.
   *
   * Used by _createTranscriptFromAiSource to normalise aiSource.sourceContent
   * (a structured markdown note) before feeding it into appendToTranscript /
   * replaceTranscript — identical to how transcribedText (always raw) is used
   * on the transcriptId path.
   */
  private stripMarkdown(text: string): string {
    return text
      .replace(/\*\*(.*?)\*\*/g, '$1')   // bold
      .replace(/\*(.*?)\*/g, '$1')        // italic
      .replace(/^#{1,6}\s+/gm, '')        // headings
      .replace(/^[-*+]\s+/gm, '')         // unordered list bullets
      .replace(/^\d+\.\s+/gm, '')         // ordered list numbers
      .replace(/`{1,3}[^`]*`{1,3}/g, '')  // inline + fenced code
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → label only
      .replace(/^>\s+/gm, '')             // blockquotes
      .replace(/---+/g, '')               // horizontal rules
      .replace(/\n{3,}/g, '\n\n')         // collapse excess blank lines
      .trim();
  }

  /**
   * Safe number conversion utility.
   *
   * @param value - Value to convert
   * @returns Number or undefined if not convertible
   */
  private ensureNumber(value: any): number | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'number') return isNaN(value) ? undefined : value;
    const parsed = Number(value);
    return isNaN(parsed) ? undefined : parsed;
  }

  /**
   * Map a RecordingsTranscript entity to a response DTO.
   *
   * @param transcript - Transcript entity
   * @returns Mapped DTO object
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
   * Remove markdown code blocks and formatting from AI output.
   *
   * @param content - Raw AI output
   * @returns Cleaned content string
   */
  private cleanContent(content: string): string {
    if (!content) return '';

    let cleaned = content.trim();

    // Remove markdown code blocks
    cleaned = cleaned.replace(/^```json\s*/i, '');
    cleaned = cleaned.replace(/^```\s*/i, '');
    cleaned = cleaned.replace(/```$/g, '');

    // Remove multiple backticks
    cleaned = cleaned.replace(/^`+/, '');
    cleaned = cleaned.replace(/`+$/, '');

    return cleaned.trim();
  }

  /**
   * Get the best available (healthy) AI provider.
   *
   * Checks provider health status and returns the first healthy provider
   * in priority order.
   *
   * @param preferredProvider - Optional preferred provider
   * @returns Best available AIProvider
   */
  private getBestAvailableProvider(preferredProvider?: AIProvider): AIProvider {
    // If preferred provider is healthy, use it
    if (preferredProvider && this.providerHealthStatus[preferredProvider]) {
      return preferredProvider;
    }

    // Check configured default provider
    const configuredDefault = this.configService.get<string>('DEFAULT_AI_PROVIDER');
    if (configuredDefault) {
      const upperDefault = configuredDefault.toLowerCase() as AIProvider;
      if (this.providerHealthStatus[upperDefault]) {
        return upperDefault;
      }
    }

    // Priority order fallback
    const priorityOrder: AIProvider[] = [
      AIProvider.OPENAI,
      AIProvider.ANTHROPIC,
      AIProvider.GEMINI,
    ];

    for (const provider of priorityOrder) {
      if (this.providerHealthStatus[provider]) {
        return provider;
      }
    }

    // Default to OpenAI even if unhealthy (let the strategy handle errors)
    return AIProvider.OPENAI;
  }

  /**
   * Get default model for an AI provider from configuration.
   *
   * @param provider - AI provider
   * @returns Default model string
   */
  private getDefaultModel(provider?: AIProvider): string {
    const resolvedProvider = provider || this.getBestAvailableProvider();

    const configKeyMap: Record<string, string> = {
      [AIProvider.OPENAI]: 'OPENAI_DEFAULT_MODEL',
      [AIProvider.ANTHROPIC]: 'ANTHROPIC_DEFAULT_MODEL',
      [AIProvider.GEMINI]: 'GEMINI_DEFAULT_MODEL',
    };

    const defaultModelMap: Record<string, string> = {
      [AIProvider.OPENAI]: 'gpt-4-turbo',
      [AIProvider.ANTHROPIC]: 'claude-3-sonnet-20240229',
      [AIProvider.GEMINI]: 'gemini-pro',
    };

    const configKey = configKeyMap[resolvedProvider];
    if (configKey) {
      const configuredModel = this.configService.get<string>(configKey);
      if (configuredModel) {
        return configuredModel;
      }
    }

    return defaultModelMap[resolvedProvider] || 'gpt-4-turbo';
  }

  /**
   * Get fallback model and provider when primary fails.
   *
   * @param provider - Failed provider
   * @returns Fallback provider and model
   */
  private getFallbackModel(provider: AIProvider): { provider: AIProvider; model: string } {
    const fallbackChain: Record<AIProvider, AIProvider[]> = {
      [AIProvider.OPENAI]: [AIProvider.ANTHROPIC, AIProvider.GEMINI],
      [AIProvider.ANTHROPIC]: [AIProvider.OPENAI, AIProvider.GEMINI],
      [AIProvider.GEMINI]: [AIProvider.OPENAI, AIProvider.ANTHROPIC],
      [AIProvider.AZURE_AI]: [AIProvider.OPENAI, AIProvider.ANTHROPIC],
      [AIProvider.CUSTOM]: [AIProvider.OPENAI, AIProvider.ANTHROPIC],
    };

    const chain = fallbackChain[provider] || [AIProvider.OPENAI];

    for (const fallbackProvider of chain) {
      if (this.providerHealthStatus[fallbackProvider]) {
        return {
          provider: fallbackProvider,
          model: this.getDefaultModel(fallbackProvider),
        };
      }
    }

    // Return OpenAI as last resort
    return {
      provider: AIProvider.OPENAI,
      model: this.getDefaultModel(AIProvider.OPENAI),
    };
  }

  /**
   * Safe audit log helper - catches and logs audit failures without
   * interrupting the main operation flow.
   *
   * @param dto - Audit log data
   * @param workspaceId - Tenant workspace ID
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
}
