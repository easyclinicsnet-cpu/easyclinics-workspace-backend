import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource , IsNull } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { LetterAiGenerationService } from './letter-ai-generation.service';
import { AiUsageReportingService, AiOperation, AiUsageStatus } from './ai-usage-reporting.service';
import { AIProvider } from '../../../common/enums';
import { ReferralLetterRepository } from '../repositories/referral-letter.repository';
import { SickNoteRepository } from '../repositories/sick-note.repository';
import { CareNoteRepository } from '../repositories/care-note.repository';
import { RecordingsTranscriptRepository } from '../repositories/recordings-transcript.repository';
import { ReferralLetter } from '../entities/referral-letter.entity';
import { SickNote } from '../entities/sick-note.entity';
import { RecordingsTranscript } from '../entities/recordings-transcript.entity';
import {
  CreateReferralLetterDto,
  GenerateReferralLetterDto,
  UpdateReferralLetterDto,
  ReferralLetterQueryDto,
  ReferralLetterResponseDto,
  CreateSickNoteDto,
  GenerateSickNoteDto,
  UpdateSickNoteDto,
  ExtendSickNoteDto,
  SickNoteQueryDto,
  SickNoteResponseDto,
  PaginatedResponseDto,
} from '../dto';
import {
  ReferralStatus,
  SickNoteStatus,
  AuditEventType,
  AuditOutcome,
} from '../../../common/enums';

// ============================================================================
// Interfaces
// ============================================================================

/**
 * Options for paginated query methods.
 */
interface PaginationOptions {
  page?: number;
  limit?: number;
}

/**
 * Combined letter result returned by getAllLettersByConsultation.
 */
interface CombinedLettersResult {
  referralLetters: ReferralLetterResponseDto[];
  sickNotes: SickNoteResponseDto[];
  totalReferrals: number;
  totalSickNotes: number;
}

/**
 * Health check result structure.
 */
interface HealthCheckResult {
  service: string;
  healthy: boolean;
  aiService: { healthy: boolean; details?: string };
  database: { healthy: boolean; details?: string };
  timestamp: string;
}

// ============================================================================
// LetterGenerationService
// ============================================================================

/**
 * LetterGenerationService
 *
 * Comprehensive service for generating, managing, and tracking medical letters
 * including referral letters and sick notes. Integrates with AI-powered content
 * generation, multi-tenant workspace isolation, and full audit trail logging.
 *
 * Business capabilities:
 * - Basic CRUD for referral letters and sick notes
 * - AI-powered content generation using consultation transcripts and patient context
 * - Content regeneration and update with automatic AI re-generation
 * - State machine lifecycle (draft -> issued -> sent, draft -> issued -> cancelled)
 * - Sick note extension with cloning from original notes
 * - Patient and consultation scoped queries
 * - Health check for operational monitoring
 */
@Injectable()
export class LetterGenerationService {
  private readonly defaultPage = 1;
  private readonly defaultLimit = 20;

  constructor(
    private readonly referralRepository: ReferralLetterRepository,
    private readonly sickNoteRepository: SickNoteRepository,
    private readonly careNoteRepository: CareNoteRepository,
    private readonly transcriptRepository: RecordingsTranscriptRepository,
    private readonly auditLogService: AuditLogService,
    private readonly letterAiService: LetterAiGenerationService,
    private readonly aiUsageReportingService: AiUsageReportingService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('LetterGenerationService');
    this.logger.log('LetterGenerationService initialized');
  }

  // ==========================================================================
  // SECTION 1: BASIC CRUD — Referral Letters
  // ==========================================================================

  /**
   * Create a referral letter with manual content (no AI generation).
   * Sets the letter to DRAFT status.
   *
   * @param dto - The data for the new referral letter
   * @param userId - The ID of the creating doctor/user
   * @param workspaceId - The workspace for multi-tenant isolation
   * @returns The created referral letter response
   */
  async createReferralLetter(
    dto: CreateReferralLetterDto,
    userId: string,
    workspaceId: string,
  ): Promise<ReferralLetterResponseDto> {
    this.logger.log(
      `Creating referral letter for patient: ${dto.patientId}, workspace: ${workspaceId}`,
    );

    try {
      const referral = this.referralRepository.create({
        ...dto,
        workspaceId,
        referringDoctorId: userId,
        status: ReferralStatus.DRAFT,
        specialty: dto.referredToSpecialty || 'General',
        reasonForReferral: dto.reasonForReferral,
        clinicalHistory: dto.relevantHistory || '',
        currentMedications: dto.currentMedications || '',
        investigations: dto.investigationResults || '',
        referredToName: dto.referredTo || '',
        referralDate: new Date(),
        expectedAppointmentDate: dto.appointmentDate
          ? new Date(dto.appointmentDate)
          : undefined,
      } as any);

      const saved = (await this.referralRepository.save(referral) as unknown) as ReferralLetter;

      await this.logAuditEvent(
        AuditEventType.CREATE,
        AuditOutcome.SUCCESS,
        'ReferralLetter',
        saved.id,
        userId,
        workspaceId,
        'Created referral letter',
        { patientId: dto.patientId },
      );

      this.logger.log(`Referral letter created successfully: ${saved.id}`);
      return this.mapReferralToResponse(saved);
    } catch (error) {
      this.logger.error(
        `Failed to create referral letter: ${this.extractErrorMessage(error)}`,
        this.extractErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * Update a referral letter's manual fields (non-AI).
   * Only draft letters can be edited.
   *
   * @param id - The referral letter ID
   * @param dto - The fields to update
   * @param userId - The user performing the update
   * @param workspaceId - The workspace for multi-tenant isolation
   * @returns The updated referral letter response
   */
  async updateReferralLetter(
    id: string,
    dto: UpdateReferralLetterDto,
    userId: string,
    workspaceId: string,
  ): Promise<ReferralLetterResponseDto> {
    this.logger.log(`Updating referral letter: ${id}`);

    const referral = await this.findReferralOrFail(id, workspaceId);

    if (referral.status !== ReferralStatus.DRAFT) {
      throw new ConflictException(
        'Only draft referral letters can be edited. Current status: ' +
          referral.status,
      );
    }

    try {
      // Apply updates selectively
      if (dto.clinicalSummary !== undefined) {
        referral.clinicalHistory = dto.clinicalSummary;
      }
      if (dto.reasonForReferral !== undefined) {
        referral.reasonForReferral = dto.reasonForReferral;
      }
      if (dto.relevantHistory !== undefined) {
        referral.clinicalHistory = dto.relevantHistory;
      }
      if (dto.currentMedications !== undefined) {
        referral.currentMedications = dto.currentMedications;
      }
      if (dto.investigationResults !== undefined) {
        referral.investigations = dto.investigationResults;
      }
      if (dto.referredTo !== undefined) {
        referral.referredToName = dto.referredTo;
      }
      if (dto.referredToSpecialty !== undefined) {
        referral.specialty = dto.referredToSpecialty;
      }
      if (dto.urgency !== undefined) {
        referral.urgency = dto.urgency;
      }
      if (dto.appointmentDate) {
        referral.expectedAppointmentDate = new Date(dto.appointmentDate);
      }

      const updated = await this.referralRepository.save(referral);

      await this.logAuditEvent(
        AuditEventType.UPDATE,
        AuditOutcome.SUCCESS,
        'ReferralLetter',
        id,
        userId,
        workspaceId,
        'Updated referral letter',
        { changes: Object.keys(dto) },
      );

      this.logger.log(`Referral letter updated successfully: ${id}`);
      return this.mapReferralToResponse(updated);
    } catch (error) {
      this.logger.error(
        `Failed to update referral letter: ${this.extractErrorMessage(error)}`,
        this.extractErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * Issue a referral letter, transitioning from DRAFT to SENT.
   * Sets issuedAt and sentAt timestamps.
   *
   * @param id - The referral letter ID
   * @param userId - The user issuing the letter
   * @param workspaceId - The workspace for multi-tenant isolation
   * @returns The issued referral letter response
   */
  async issueReferralLetter(
    id: string,
    userId: string,
    workspaceId: string,
  ): Promise<ReferralLetterResponseDto> {
    this.logger.log(`Issuing referral letter: ${id}`);

    const referral = await this.findReferralOrFail(id, workspaceId);

    if (referral.status !== ReferralStatus.DRAFT) {
      throw new ConflictException(
        'Only draft referral letters can be issued. Current status: ' +
          referral.status,
      );
    }

    // Validate that required content is present before issuing
    if (!referral.reasonForReferral || referral.reasonForReferral.trim() === '') {
      throw new BadRequestException(
        'Referral letter must have a reason for referral before it can be issued',
      );
    }

    try {
      referral.status = ReferralStatus.SENT;
      referral.referralDate = new Date();

      const issued = await this.referralRepository.save(referral);

      await this.logAuditEvent(
        AuditEventType.UPDATE,
        AuditOutcome.SUCCESS,
        'ReferralLetter',
        id,
        userId,
        workspaceId,
        'Issued referral letter',
        { action: 'issue', previousStatus: ReferralStatus.DRAFT },
      );

      this.logger.log(`Referral letter issued successfully: ${id}`);
      return this.mapReferralToResponse(issued);
    } catch (error) {
      this.logger.error(
        `Failed to issue referral letter: ${this.extractErrorMessage(error)}`,
        this.extractErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * Send a referral letter (mark as sent). Only non-draft, non-cancelled letters
   * can be sent.
   *
   * @param id - The referral letter ID
   * @param userId - The user sending the letter
   * @param workspaceId - The workspace for multi-tenant isolation
   * @returns The sent referral letter response
   */
  async sendReferralLetter(
    id: string,
    userId: string,
    workspaceId: string,
  ): Promise<ReferralLetterResponseDto> {
    this.logger.log(`Sending referral letter: ${id}`);

    const referral = await this.findReferralOrFail(id, workspaceId);

    if (referral.status === ReferralStatus.DRAFT) {
      throw new ConflictException(
        'Cannot send draft referral letters. Issue the letter first.',
      );
    }

    if (referral.status === ReferralStatus.CANCELLED) {
      throw new ConflictException('Cannot send cancelled referral letters.');
    }

    try {
      // Update the sent timestamp (re-send scenario)
      referral.referralDate = referral.referralDate || new Date();

      const sent = await this.referralRepository.save(referral);

      await this.logAuditEvent(
        AuditEventType.UPDATE,
        AuditOutcome.SUCCESS,
        'ReferralLetter',
        id,
        userId,
        workspaceId,
        'Sent referral letter',
        { action: 'send' },
      );

      this.logger.log(`Referral letter sent successfully: ${id}`);
      return this.mapReferralToResponse(sent);
    } catch (error) {
      this.logger.error(
        `Failed to send referral letter: ${this.extractErrorMessage(error)}`,
        this.extractErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * Find referral letters with query filters and pagination.
   *
   * @param query - The query filters
   * @param workspaceId - The workspace for multi-tenant isolation
   * @returns Paginated referral letter responses
   */
  async findReferralLetters(
    query: ReferralLetterQueryDto,
    workspaceId: string,
  ): Promise<PaginatedResponseDto<ReferralLetterResponseDto>> {
    this.logger.debug('Finding referral letters with filters');

    const [referrals, total] =
      await this.referralRepository.findWithFilters(query, workspaceId);

    const data = referrals.map((r) => this.mapReferralToResponse(r));

    return new PaginatedResponseDto(
      data,
      total,
      query.page || this.defaultPage,
      query.limit || this.defaultLimit,
    );
  }

  // ==========================================================================
  // SECTION 2: BASIC CRUD — Sick Notes
  // ==========================================================================

  /**
   * Create a sick note with manual content (no AI generation).
   * Validates date ranges and calculates duration. Sets status to DRAFT.
   *
   * @param dto - The data for the new sick note
   * @param userId - The ID of the creating doctor/user
   * @param workspaceId - The workspace for multi-tenant isolation
   * @returns The created sick note response
   */
  async createSickNote(
    dto: CreateSickNoteDto,
    userId: string,
    workspaceId: string,
  ): Promise<SickNoteResponseDto> {
    this.logger.log(
      `Creating sick note for patient: ${dto.patientId}, workspace: ${workspaceId}`,
    );

    // Validate dates
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (startDate > endDate) {
      throw new BadRequestException(
        'Start date must be before or equal to end date',
      );
    }

    // Calculate duration in days (inclusive)
    const durationDays = this.calculateDurationDays(startDate, endDate);

    try {
      const sickNote = this.sickNoteRepository.create({
        patientId: dto.patientId,
        consultationId: dto.consultationId || undefined,
        doctorId: userId,
        workspaceId,
        status: SickNoteStatus.DRAFT,
        issueDate: new Date(),
        startDate,
        endDate,
        durationDays,
        diagnosis: dto.diagnosis,
        recommendations: dto.recommendations || '',
        isFitForLightDuties: dto.isFitForLightDuties ?? false,
        lightDutiesDescription: dto.lightDutiesDescription,
        employerName: dto.employerName,
        employerAddress: dto.employerAddress,
        certificateNumber: dto.certificateNumber,
        metadata: {},
      } as any);

      const saved = (await this.sickNoteRepository.save(sickNote) as unknown) as SickNote;

      await this.logAuditEvent(
        AuditEventType.CREATE,
        AuditOutcome.SUCCESS,
        'SickNote',
        saved.id,
        userId,
        workspaceId,
        'Created sick note',
        { patientId: dto.patientId, durationDays },
      );

      this.logger.log(`Sick note created successfully: ${saved.id}`);
      return this.mapSickNoteToResponse(saved);
    } catch (error) {
      this.logger.error(
        `Failed to create sick note: ${this.extractErrorMessage(error)}`,
        this.extractErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * Update a sick note's manual fields. Only draft notes can be edited.
   * Recalculates duration if dates change.
   *
   * @param id - The sick note ID
   * @param dto - The fields to update
   * @param userId - The user performing the update
   * @param workspaceId - The workspace for multi-tenant isolation
   * @returns The updated sick note response
   */
  async updateSickNote(
    id: string,
    dto: UpdateSickNoteDto,
    userId: string,
    workspaceId: string,
  ): Promise<SickNoteResponseDto> {
    this.logger.log(`Updating sick note: ${id}`);

    const sickNote = await this.findSickNoteOrFail(id, workspaceId);

    if (sickNote.status !== SickNoteStatus.DRAFT) {
      throw new ConflictException(
        'Only draft sick notes can be edited. Current status: ' +
          sickNote.status,
      );
    }

    try {
      // Apply updates selectively
      if (dto.diagnosis !== undefined) {
        sickNote.diagnosis = dto.diagnosis;
      }
      if (dto.recommendations !== undefined) {
        sickNote.recommendations = dto.recommendations;
      }
      if (dto.isFitForLightDuties !== undefined) {
        sickNote.isFitForLightDuties = dto.isFitForLightDuties;
      }
      if (dto.lightDutiesDescription !== undefined) {
        sickNote.lightDutiesDescription = dto.lightDutiesDescription;
      }
      if (dto.employerName !== undefined) {
        sickNote.employerName = dto.employerName;
      }
      if (dto.employerAddress !== undefined) {
        sickNote.employerAddress = dto.employerAddress;
      }
      if (dto.certificateNumber !== undefined) {
        sickNote.certificateNumber = dto.certificateNumber;
      }

      // Recalculate duration if dates changed
      if (dto.startDate || dto.endDate) {
        const startDate = dto.startDate
          ? new Date(dto.startDate)
          : sickNote.startDate;
        const endDate = dto.endDate
          ? new Date(dto.endDate)
          : sickNote.endDate;

        if (startDate > endDate) {
          throw new BadRequestException(
            'Start date must be before or equal to end date',
          );
        }

        sickNote.startDate = startDate;
        sickNote.endDate = endDate;
        sickNote.durationDays = this.calculateDurationDays(startDate, endDate);
      }

      const updated = await this.sickNoteRepository.save(sickNote);

      await this.logAuditEvent(
        AuditEventType.UPDATE,
        AuditOutcome.SUCCESS,
        'SickNote',
        id,
        userId,
        workspaceId,
        'Updated sick note',
        { changes: Object.keys(dto) },
      );

      this.logger.log(`Sick note updated successfully: ${id}`);
      return this.mapSickNoteToResponse(updated);
    } catch (error) {
      this.logger.error(
        `Failed to update sick note: ${this.extractErrorMessage(error)}`,
        this.extractErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * Issue a sick note, transitioning from DRAFT to ISSUED.
   * Sets the issuedAt timestamp.
   *
   * @param id - The sick note ID
   * @param userId - The user issuing the note
   * @param workspaceId - The workspace for multi-tenant isolation
   * @returns The issued sick note response
   */
  async issueSickNote(
    id: string,
    userId: string,
    workspaceId: string,
  ): Promise<SickNoteResponseDto> {
    this.logger.log(`Issuing sick note: ${id}`);

    const sickNote = await this.findSickNoteOrFail(id, workspaceId);

    if (sickNote.status !== SickNoteStatus.DRAFT) {
      throw new ConflictException(
        'Only draft sick notes can be issued. Current status: ' +
          sickNote.status,
      );
    }

    // Validate that the note has minimum required content
    if (!sickNote.diagnosis || sickNote.diagnosis.trim() === '') {
      throw new BadRequestException(
        'Sick note must have a diagnosis before it can be issued',
      );
    }

    // Validate that end date is not in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (sickNote.endDate < today) {
      this.logger.warn(
        `Issuing sick note ${id} with an end date in the past: ${sickNote.endDate.toISOString()}`,
      );
    }

    try {
      sickNote.status = SickNoteStatus.ISSUED;
      sickNote.issueDate = new Date();

      const issued = await this.sickNoteRepository.save(sickNote);

      await this.logAuditEvent(
        AuditEventType.UPDATE,
        AuditOutcome.SUCCESS,
        'SickNote',
        id,
        userId,
        workspaceId,
        'Issued sick note',
        {
          action: 'issue',
          previousStatus: SickNoteStatus.DRAFT,
          durationDays: sickNote.durationDays,
        },
      );

      this.logger.log(`Sick note issued successfully: ${id}`);
      return this.mapSickNoteToResponse(issued);
    } catch (error) {
      this.logger.error(
        `Failed to issue sick note: ${this.extractErrorMessage(error)}`,
        this.extractErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * Cancel a sick note. Only DRAFT or ISSUED notes can be cancelled.
   * Cancelled notes cannot be re-activated.
   *
   * @param id - The sick note ID
   * @param userId - The user cancelling the note
   * @param workspaceId - The workspace for multi-tenant isolation
   * @param reason - The reason for cancellation (required for audit)
   * @returns The cancelled sick note response
   */
  async cancelSickNote(
    id: string,
    userId: string,
    workspaceId: string,
    reason?: string,
  ): Promise<SickNoteResponseDto> {
    this.logger.log(`Cancelling sick note: ${id}, reason: ${reason || 'N/A'}`);

    const sickNote = await this.findSickNoteOrFail(id, workspaceId);

    if (sickNote.status === SickNoteStatus.CANCELLED) {
      throw new ConflictException('Sick note is already cancelled.');
    }

    if (sickNote.status === SickNoteStatus.EXPIRED) {
      throw new ConflictException(
        'Cannot cancel an expired sick note. It has already concluded.',
      );
    }

    const previousStatus = sickNote.status;

    try {
      sickNote.status = SickNoteStatus.CANCELLED;
      // Store cancellation metadata
      sickNote.metadata = {
        ...sickNote.metadata,
        cancelledAt: new Date().toISOString(),
        cancelledBy: userId,
        cancellationReason: reason || 'No reason provided',
        previousStatus,
      };

      const cancelled = await this.sickNoteRepository.save(sickNote);

      await this.logAuditEvent(
        AuditEventType.UPDATE,
        AuditOutcome.SUCCESS,
        'SickNote',
        id,
        userId,
        workspaceId,
        'Cancelled sick note',
        {
          action: 'cancel',
          previousStatus,
          cancellationReason: reason || 'No reason provided',
        },
      );

      this.logger.log(`Sick note cancelled successfully: ${id}`);
      return this.mapSickNoteToResponse(cancelled);
    } catch (error) {
      this.logger.error(
        `Failed to cancel sick note: ${this.extractErrorMessage(error)}`,
        this.extractErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * Extend a sick note by creating a new note linked to the original.
   * Copies clinical data from the original note and extends the date range.
   * Optionally generates AI content for the extension.
   *
   * @param dto - Extension parameters including original note ID and new end date
   * @param userId - The user extending the note
   * @param workspaceId - The workspace for multi-tenant isolation
   * @returns The new extension sick note response
   */
  async extendSickNote(
    dto: ExtendSickNoteDto,
    userId: string,
    workspaceId: string,
  ): Promise<SickNoteResponseDto> {
    this.logger.log(`Extending sick note: ${dto.originalNoteId}`);

    const originalNote = await this.sickNoteRepository.findOne({
      where: { id: dto.originalNoteId, workspaceId, deletedAt: IsNull() },
    });

    if (!originalNote) {
      throw new NotFoundException(
        `Original sick note not found: ${dto.originalNoteId}`,
      );
    }

    // Only issued notes can be extended
    if (
      originalNote.status !== SickNoteStatus.ISSUED &&
      originalNote.status !== SickNoteStatus.EXPIRED
    ) {
      throw new ConflictException(
        'Only issued or expired sick notes can be extended. Current status: ' +
          originalNote.status,
      );
    }

    // Validate new end date is after original end date
    const newEndDate = new Date(dto.newEndDate);
    if (newEndDate <= originalNote.endDate) {
      throw new BadRequestException(
        'New end date must be after the original end date (' +
          originalNote.endDate.toISOString().split('T')[0] +
          ')',
      );
    }

    // Extension starts where original ends
    const extensionStartDate = new Date(originalNote.endDate);
    extensionStartDate.setDate(extensionStartDate.getDate() + 1);

    try {
      // Attempt AI-generated extension content
      let extensionContent: string | null = null;
      let aiMetadata: any = null;

      try {
        const extensionStartTime = Date.now();
        const patientContext = await this.buildPatientContextById(
          originalNote.patientId,
          workspaceId,
        );
        const transcriptContent = originalNote.consultationId
          ? await this.getConsultationTranscriptContent(
              originalNote.consultationId,
              workspaceId,
            )
          : '';

        const aiResult = await this.letterAiService.generateSickNoteExtension({
          patient: await this.getPatientInfo(originalNote.patientId, workspaceId),
          comprehensivePatientHistory: patientContext,
          comprehensiveTranscript: transcriptContent,
          originalDiagnosis: originalNote.diagnosis,
          originalIcd10Code: originalNote.metadata?.icd10Code || '',
          originalClinicalSummary: originalNote.recommendations || '',
          originalStartDate: originalNote.startDate.toISOString().split('T')[0],
          originalEndDate: originalNote.endDate.toISOString().split('T')[0],
          workRestriction: originalNote.metadata?.workRestriction || 'full_rest',
          specificRestrictions: originalNote.lightDutiesDescription || '',
          newEndDate: newEndDate.toISOString().split('T')[0],
          extensionReason: 'Continuation of medical condition requiring ongoing work restriction',
        });

        extensionContent = aiResult.finalLetter;
        aiMetadata = aiResult.metadata;

        // Report AI usage to portal for billing
        this.reportLetterAiUsage(userId, workspaceId, AiOperation.LETTER_GENERATION,
          aiMetadata?.model ?? 'gpt-4o', aiMetadata?.tokensUsed ?? 0, Date.now() - extensionStartTime,
          AiUsageStatus.COMPLETED);

        this.logger.log(
          `AI extension content generated for sick note: ${dto.originalNoteId}`,
        );
      } catch (aiError) {
        this.logger.warn(
          `AI content generation failed for extension, proceeding without AI content: ${this.extractErrorMessage(aiError)}`,
        );
      }

      // Clone the original note with new dates
      const extension = this.sickNoteRepository.create({
        patientId: originalNote.patientId,
        consultationId: originalNote.consultationId,
        doctorId: userId,
        workspaceId,
        status: SickNoteStatus.DRAFT,
        issueDate: new Date(),
        startDate: extensionStartDate,
        endDate: newEndDate,
        durationDays: dto.extendedDuration,
        diagnosis: originalNote.diagnosis,
        recommendations: extensionContent || originalNote.recommendations || '',
        isFitForLightDuties: originalNote.isFitForLightDuties,
        lightDutiesDescription: originalNote.lightDutiesDescription,
        metadata: {
          ...originalNote.metadata,
          originalNoteId: originalNote.id,
          isExtension: true,
          extensionOf: originalNote.id,
          extensionDate: new Date().toISOString(),
          aiGenerated: !!extensionContent,
          aiMetadata: aiMetadata || null,
        },
      });

      const saved = await this.sickNoteRepository.save(extension);

      await this.logAuditEvent(
        AuditEventType.CREATE,
        AuditOutcome.SUCCESS,
        'SickNote',
        saved.id,
        userId,
        workspaceId,
        'Extended sick note',
        {
          action: 'extend',
          originalNoteId: dto.originalNoteId,
          extendedDuration: dto.extendedDuration,
          aiGenerated: !!extensionContent,
        },
      );

      this.logger.log(`Sick note extended successfully: ${saved.id}`);
      return this.mapSickNoteToResponse(saved);
    } catch (error) {
      this.logger.error(
        `Failed to extend sick note: ${this.extractErrorMessage(error)}`,
        this.extractErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * Find sick notes with query filters and pagination.
   *
   * @param query - The query filters
   * @param workspaceId - The workspace for multi-tenant isolation
   * @returns Paginated sick note responses
   */
  async findSickNotes(
    query: SickNoteQueryDto,
    workspaceId: string,
  ): Promise<PaginatedResponseDto<SickNoteResponseDto>> {
    this.logger.debug('Finding sick notes with filters');

    const [sickNotes, total] = await this.sickNoteRepository.findWithFilters(
      query,
      workspaceId,
    );

    const data = sickNotes.map((s) => this.mapSickNoteToResponse(s));

    return new PaginatedResponseDto(
      data,
      total,
      query.page || this.defaultPage,
      query.limit || this.defaultLimit,
    );
  }

  // ==========================================================================
  // SECTION 3: AI-POWERED GENERATION
  // ==========================================================================

  /**
   * Generate a referral letter with AI-powered content.
   * Builds comprehensive patient context, merges consultation transcripts,
   * and calls the LetterAiGenerationService for content generation.
   *
   * @param dto - The data for the referral letter
   * @param userId - The creating doctor/user ID
   * @param workspaceId - The workspace for multi-tenant isolation
   * @returns The created referral letter with AI-generated content
   */
  async generateReferralLetter(
    dto: GenerateReferralLetterDto,
    userId: string,
    workspaceId: string,
  ): Promise<ReferralLetterResponseDto> {
    const operationId = `gen_referral_${Date.now()}`;
    this.logger.log(
      `[${operationId}] Generating AI referral letter for patient: ${dto.patientId}`,
    );

    try {
      // 1. Build comprehensive patient context
      let patientContext = await this.buildPatientContextById(
        dto.patientId,
        workspaceId,
      );

      // 1b. Append care note content when noteId is provided — primary AI context source
      if (dto.noteId) {
        const noteContent = await this.fetchCareNoteContent(dto.noteId, workspaceId);
        if (noteContent) {
          patientContext = `${patientContext}\n\n=== CARE NOTE (AI SOURCE) ===\n${noteContent}`;
        }
      }

      // 2. Fetch and merge transcripts if consultation is provided
      let mergedTranscript = '';
      if (dto.consultationId) {
        mergedTranscript = await this.getConsultationTranscriptContent(
          dto.consultationId,
          workspaceId,
        );
      }

      // 3. Get patient info for the AI prompt
      const patientInfo = await this.getPatientInfo(dto.patientId, workspaceId);

      // 4. Call AI generation service
      const aiResult = await this.generateReferralContent(
        patientInfo,
        patientContext,
        mergedTranscript,
        dto,
        userId,
        workspaceId,
      );

      this.logger.log(
        `[${operationId}] AI content generated, creating referral letter entity`,
      );

      // 5. Create the referral letter entity with generated content
      const referral = this.referralRepository.create({
        workspaceId,
        patientId: dto.patientId,
        consultationId: dto.consultationId || undefined,
        referringDoctorId: userId,
        status: ReferralStatus.DRAFT,
        urgency: dto.urgency,
        specialty: dto.referredToSpecialty || 'General',
        // AI fills in clinicalSummary / reasonForReferral when not provided by doctor
        reasonForReferral: dto.reasonForReferral || aiResult.structuredContent?.managementRationale || '',
        clinicalHistory: aiResult.structuredContent?.clinicalHistory || dto.relevantHistory || '',
        examinationFindings: aiResult.structuredContent?.examinationSummary || '',
        investigations: dto.investigationResults || '',
        currentMedications: dto.currentMedications || '',
        additionalNotes: aiResult.finalLetter,
        referredToName: dto.referredTo || '',
        referralDate: new Date(),
        expectedAppointmentDate: dto.appointmentDate
          ? new Date(dto.appointmentDate)
          : undefined,
        metadata: {
          aiGenerated: true,
          aiMetadata: aiResult.metadata,
          generatedAt: new Date().toISOString(),
          noteId: dto.noteId || null,
          transcriptSections: mergedTranscript
            ? this.countTranscriptSections(mergedTranscript)
            : 0,
          provisionalDiagnosis: dto.provisionalDiagnosis || null,
          allergies: dto.allergies || null,
        },
      } as any);

      const saved = (await this.referralRepository.save(referral) as unknown) as ReferralLetter;

      await this.logAuditEvent(
        AuditEventType.CREATE,
        AuditOutcome.SUCCESS,
        'ReferralLetter',
        saved.id,
        userId,
        workspaceId,
        'Generated AI referral letter',
        {
          patientId: dto.patientId,
          aiGenerated: true,
          tokensUsed: aiResult.metadata?.tokensUsed || 0,
        },
      );

      this.logger.log(
        `[${operationId}] AI referral letter created successfully: ${saved.id}`,
      );
      return this.mapReferralToResponse(saved);
    } catch (error) {
      this.logger.error(
        `[${operationId}] Failed to generate AI referral letter: ${this.extractErrorMessage(error)}`,
        this.extractErrorStack(error),
      );

      await this.logAuditEvent(
        AuditEventType.CREATE,
        AuditOutcome.FAILURE,
        'ReferralLetter',
        'N/A',
        userId,
        workspaceId,
        'Failed to generate AI referral letter',
        {
          patientId: dto.patientId,
          error: this.extractErrorMessage(error),
        },
      );

      throw new InternalServerErrorException(
        'Failed to generate referral letter content. Please try again or create manually.',
      );
    }
  }

  /**
   * Generate a sick note with AI-powered content.
   * Builds comprehensive patient context, merges consultation transcripts,
   * and calls the LetterAiGenerationService for content generation.
   *
   * @param dto - The data for the sick note
   * @param userId - The creating doctor/user ID
   * @param workspaceId - The workspace for multi-tenant isolation
   * @returns The created sick note with AI-generated content
   */
  async generateSickNote(
    dto: GenerateSickNoteDto,
    userId: string,
    workspaceId: string,
  ): Promise<SickNoteResponseDto> {
    const operationId = `gen_sicknote_${Date.now()}`;
    this.logger.log(
      `[${operationId}] Generating AI sick note for patient: ${dto.patientId}`,
    );

    // Validate dates
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (startDate > endDate) {
      throw new BadRequestException(
        'Start date must be before or equal to end date',
      );
    }

    const durationDays = this.calculateDurationDays(startDate, endDate);

    try {
      // 1. Build comprehensive patient context
      let patientContext = await this.buildPatientContextById(
        dto.patientId,
        workspaceId,
      );

      // 1b. Append care note content when noteId is provided — primary AI context source
      if (dto.noteId) {
        const noteContent = await this.fetchCareNoteContent(dto.noteId, workspaceId);
        if (noteContent) {
          patientContext = `${patientContext}\n\n=== CARE NOTE (AI SOURCE) ===\n${noteContent}`;
        }
      }

      // 2. Fetch and merge transcripts if consultation is provided
      let mergedTranscript = '';
      if (dto.consultationId) {
        mergedTranscript = await this.getConsultationTranscriptContent(
          dto.consultationId,
          workspaceId,
        );
      }

      // 3. Get patient info for the AI prompt
      const patientInfo = await this.getPatientInfo(dto.patientId, workspaceId);

      // 4. Call AI generation service
      const aiResult = await this.generateSickNoteContent(
        patientInfo,
        patientContext,
        mergedTranscript,
        dto,
        userId,
        workspaceId,
      );

      this.logger.log(
        `[${operationId}] AI content generated, creating sick note entity`,
      );

      // 5. Create the sick note entity with generated content
      const sickNote = this.sickNoteRepository.create({
        patientId: dto.patientId,
        consultationId: dto.consultationId || undefined,
        doctorId: userId,
        workspaceId,
        status: SickNoteStatus.DRAFT,
        issueDate: new Date(),
        startDate,
        endDate,
        durationDays,
        // AI generates the diagnosis from the care note when not provided by the doctor
        diagnosis: dto.diagnosis || aiResult.structuredContent?.clinicalHistory?.split('\n')?.[0] || 'Per clinical assessment',
        recommendations: aiResult.finalLetter,
        isFitForLightDuties: dto.isFitForLightDuties ?? false,
        lightDutiesDescription: dto.lightDutiesDescription,
        employerName: dto.employerName,
        employerAddress: dto.employerAddress,
        certificateNumber: dto.certificateNumber,
        metadata: {
          aiGenerated: true,
          aiMetadata: aiResult.metadata,
          generatedAt: new Date().toISOString(),
          transcriptSections: mergedTranscript
            ? this.countTranscriptSections(mergedTranscript)
            : 0,
        },
      } as any);

      const saved = (await this.sickNoteRepository.save(sickNote) as unknown) as SickNote;

      await this.logAuditEvent(
        AuditEventType.CREATE,
        AuditOutcome.SUCCESS,
        'SickNote',
        saved.id,
        userId,
        workspaceId,
        'Generated AI sick note',
        {
          patientId: dto.patientId,
          aiGenerated: true,
          durationDays,
          tokensUsed: aiResult.metadata?.tokensUsed || 0,
        },
      );

      this.logger.log(
        `[${operationId}] AI sick note created successfully: ${saved.id}`,
      );
      return this.mapSickNoteToResponse(saved);
    } catch (error) {
      this.logger.error(
        `[${operationId}] Failed to generate AI sick note: ${this.extractErrorMessage(error)}`,
        this.extractErrorStack(error),
      );

      await this.logAuditEvent(
        AuditEventType.CREATE,
        AuditOutcome.FAILURE,
        'SickNote',
        'N/A',
        userId,
        workspaceId,
        'Failed to generate AI sick note',
        {
          patientId: dto.patientId,
          error: this.extractErrorMessage(error),
        },
      );

      throw new InternalServerErrorException(
        'Failed to generate sick note content. Please try again or create manually.',
      );
    }
  }

  // ==========================================================================
  // SECTION 4: AI CONTENT UPDATE & REGENERATION
  // ==========================================================================

  /**
   * Update a referral letter's content and auto-regenerate AI content.
   * Updates the manual fields first, then re-generates the AI content
   * using the updated information combined with existing context.
   *
   * @param id - The referral letter ID
   * @param dto - The fields to update
   * @param userId - The user performing the update
   * @param workspaceId - The workspace for multi-tenant isolation
   * @returns The updated referral letter with regenerated AI content
   */
  async updateReferralLetterContent(
    id: string,
    dto: UpdateReferralLetterDto,
    userId: string,
    workspaceId: string,
  ): Promise<ReferralLetterResponseDto> {
    const operationId = `update_referral_${Date.now()}`;
    this.logger.log(
      `[${operationId}] Updating referral letter content with AI regeneration: ${id}`,
    );

    const referral = await this.findReferralOrFail(id, workspaceId);

    if (referral.status !== ReferralStatus.DRAFT) {
      throw new ConflictException(
        'Only draft referral letters can have their content updated. Current status: ' +
          referral.status,
      );
    }

    try {
      // Apply manual field updates first
      if (dto.clinicalSummary !== undefined) {
        referral.clinicalHistory = dto.clinicalSummary;
      }
      if (dto.reasonForReferral !== undefined) {
        referral.reasonForReferral = dto.reasonForReferral;
      }
      if (dto.relevantHistory !== undefined) {
        referral.clinicalHistory = dto.relevantHistory;
      }
      if (dto.currentMedications !== undefined) {
        referral.currentMedications = dto.currentMedications;
      }
      if (dto.investigationResults !== undefined) {
        referral.investigations = dto.investigationResults;
      }
      if (dto.referredTo !== undefined) {
        referral.referredToName = dto.referredTo;
      }
      if (dto.referredToSpecialty !== undefined) {
        referral.specialty = dto.referredToSpecialty;
      }
      if (dto.urgency !== undefined) {
        referral.urgency = dto.urgency;
      }
      if (dto.appointmentDate) {
        referral.expectedAppointmentDate = new Date(dto.appointmentDate);
      }

      // Attempt AI regeneration with updated data
      try {
        const patientContext = await this.buildPatientContextById(
          referral.patientId,
          workspaceId,
        );
        const mergedTranscript = referral.consultationId
          ? await this.getConsultationTranscriptContent(
              referral.consultationId,
              workspaceId,
            )
          : '';
        const patientInfo = await this.getPatientInfo(
          referral.patientId,
          workspaceId,
        );

        // Build a CreateReferralLetterDto-like object from current state
        const regenerationDto: CreateReferralLetterDto = {
          patientId: referral.patientId,
          consultationId: referral.consultationId || undefined,
          referralType: referral.metadata?.referralType || 'specialist',
          urgency: referral.urgency,
          clinicalSummary: referral.clinicalHistory || '',
          reasonForReferral: referral.reasonForReferral,
          relevantHistory: referral.clinicalHistory || '',
          currentMedications: referral.currentMedications || '',
          investigationResults: referral.investigations || '',
          referredTo: referral.referredToName || '',
          referredToSpecialty: referral.specialty,
        };

        const aiResult = await this.generateReferralContent(
          patientInfo,
          patientContext,
          mergedTranscript,
          regenerationDto,
          userId,
          workspaceId,
        );

        // Update with regenerated content
        referral.additionalNotes = aiResult.finalLetter;
        if (aiResult.structuredContent) {
          referral.examinationFindings =
            aiResult.structuredContent.examinationSummary || referral.examinationFindings;
        }
        referral.metadata = {
          ...referral.metadata,
          aiGenerated: true,
          aiMetadata: aiResult.metadata,
          lastRegeneratedAt: new Date().toISOString(),
          regenerationTrigger: 'content_update',
        };

        this.logger.log(
          `[${operationId}] AI content regenerated successfully for referral: ${id}`,
        );
      } catch (aiError) {
        this.logger.warn(
          `[${operationId}] AI regeneration failed during update, saving manual changes only: ${this.extractErrorMessage(aiError)}`,
        );
        // Continue with just the manual updates
        referral.metadata = {
          ...referral.metadata,
          lastUpdateAttemptedRegeneration: true,
          regenerationFailed: true,
          regenerationError: this.extractErrorMessage(aiError),
          lastUpdatedAt: new Date().toISOString(),
        };
      }

      const updated = await this.referralRepository.save(referral);

      await this.logAuditEvent(
        AuditEventType.UPDATE,
        AuditOutcome.SUCCESS,
        'ReferralLetter',
        id,
        userId,
        workspaceId,
        'Updated referral letter content with AI regeneration',
        {
          changes: Object.keys(dto),
          aiRegenerated: !!referral.metadata?.lastRegeneratedAt,
        },
      );

      this.logger.log(
        `[${operationId}] Referral letter content updated successfully: ${id}`,
      );
      return this.mapReferralToResponse(updated);
    } catch (error) {
      this.logger.error(
        `[${operationId}] Failed to update referral letter content: ${this.extractErrorMessage(error)}`,
        this.extractErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * Update a sick note's content and auto-regenerate AI content.
   * Updates the manual fields first, then re-generates the AI content
   * using the updated information combined with existing context.
   *
   * @param id - The sick note ID
   * @param dto - The fields to update
   * @param userId - The user performing the update
   * @param workspaceId - The workspace for multi-tenant isolation
   * @returns The updated sick note with regenerated AI content
   */
  async updateSickNoteContent(
    id: string,
    dto: UpdateSickNoteDto,
    userId: string,
    workspaceId: string,
  ): Promise<SickNoteResponseDto> {
    const operationId = `update_sicknote_${Date.now()}`;
    this.logger.log(
      `[${operationId}] Updating sick note content with AI regeneration: ${id}`,
    );

    const sickNote = await this.findSickNoteOrFail(id, workspaceId);

    if (sickNote.status !== SickNoteStatus.DRAFT) {
      throw new ConflictException(
        'Only draft sick notes can have their content updated. Current status: ' +
          sickNote.status,
      );
    }

    try {
      // Apply manual field updates first
      if (dto.diagnosis !== undefined) {
        sickNote.diagnosis = dto.diagnosis;
      }
      if (dto.recommendations !== undefined) {
        sickNote.recommendations = dto.recommendations;
      }
      if (dto.isFitForLightDuties !== undefined) {
        sickNote.isFitForLightDuties = dto.isFitForLightDuties;
      }
      if (dto.lightDutiesDescription !== undefined) {
        sickNote.lightDutiesDescription = dto.lightDutiesDescription;
      }
      if (dto.employerName !== undefined) {
        sickNote.employerName = dto.employerName;
      }
      if (dto.employerAddress !== undefined) {
        sickNote.employerAddress = dto.employerAddress;
      }
      if (dto.certificateNumber !== undefined) {
        sickNote.certificateNumber = dto.certificateNumber;
      }

      // Recalculate duration if dates changed
      if (dto.startDate || dto.endDate) {
        const startDate = dto.startDate
          ? new Date(dto.startDate)
          : sickNote.startDate;
        const endDate = dto.endDate
          ? new Date(dto.endDate)
          : sickNote.endDate;

        if (startDate > endDate) {
          throw new BadRequestException(
            'Start date must be before or equal to end date',
          );
        }

        sickNote.startDate = startDate;
        sickNote.endDate = endDate;
        sickNote.durationDays = this.calculateDurationDays(startDate, endDate);
      }

      // Attempt AI regeneration with updated data
      try {
        const patientContext = await this.buildPatientContextById(
          sickNote.patientId,
          workspaceId,
        );
        const mergedTranscript = sickNote.consultationId
          ? await this.getConsultationTranscriptContent(
              sickNote.consultationId,
              workspaceId,
            )
          : '';
        const patientInfo = await this.getPatientInfo(
          sickNote.patientId,
          workspaceId,
        );

        // Build a context object from current state for AI regeneration
        const regenerationDto: any = {
          patientId: sickNote.patientId,
          consultationId: sickNote.consultationId || undefined,
          diagnosis: sickNote.diagnosis,
          icd10Code: sickNote.metadata?.icd10Code || '',
          startDate: sickNote.startDate.toISOString().split('T')[0],
          endDate: sickNote.endDate.toISOString().split('T')[0],
          workRestriction: sickNote.isFitForLightDuties ? 'light_duty' : (sickNote.metadata?.workRestriction || 'full_rest'),
          clinicalSummary: sickNote.recommendations || '',
          additionalNotes: sickNote.lightDutiesDescription || sickNote.metadata?.additionalNotes || '',
          treatmentPlan: sickNote.metadata?.treatmentPlan || '',
        };

        const aiResult = await this.generateSickNoteContent(
          patientInfo,
          patientContext,
          mergedTranscript,
          regenerationDto,
          userId,
          workspaceId,
        );

        // Update with regenerated content
        sickNote.recommendations = aiResult.finalLetter;
        sickNote.metadata = {
          ...sickNote.metadata,
          aiGenerated: true,
          aiMetadata: aiResult.metadata,
          lastRegeneratedAt: new Date().toISOString(),
          regenerationTrigger: 'content_update',
        };

        this.logger.log(
          `[${operationId}] AI content regenerated successfully for sick note: ${id}`,
        );
      } catch (aiError) {
        this.logger.warn(
          `[${operationId}] AI regeneration failed during update, saving manual changes only: ${this.extractErrorMessage(aiError)}`,
        );
        sickNote.metadata = {
          ...sickNote.metadata,
          lastUpdateAttemptedRegeneration: true,
          regenerationFailed: true,
          regenerationError: this.extractErrorMessage(aiError),
          lastUpdatedAt: new Date().toISOString(),
        };
      }

      const updated = await this.sickNoteRepository.save(sickNote);

      await this.logAuditEvent(
        AuditEventType.UPDATE,
        AuditOutcome.SUCCESS,
        'SickNote',
        id,
        userId,
        workspaceId,
        'Updated sick note content with AI regeneration',
        {
          changes: Object.keys(dto),
          aiRegenerated: !!sickNote.metadata?.lastRegeneratedAt,
        },
      );

      this.logger.log(
        `[${operationId}] Sick note content updated successfully: ${id}`,
      );
      return this.mapSickNoteToResponse(updated);
    } catch (error) {
      this.logger.error(
        `[${operationId}] Failed to update sick note content: ${this.extractErrorMessage(error)}`,
        this.extractErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * Force regenerate the AI content for a referral letter.
   * Unlike updateReferralLetterContent, this does not update manual fields
   * but only re-generates the AI portion using current data.
   *
   * @param id - The referral letter ID
   * @param dto - Optional overrides for the regeneration context
   * @param userId - The user requesting regeneration
   * @param workspaceId - The workspace for multi-tenant isolation
   * @returns The referral letter with regenerated AI content
   */
  async regenerateReferralLetterContent(
    id: string,
    dto: Partial<UpdateReferralLetterDto>,
    userId: string,
    workspaceId: string,
  ): Promise<ReferralLetterResponseDto> {
    const operationId = `regen_referral_${Date.now()}`;
    this.logger.log(
      `[${operationId}] Force regenerating AI content for referral letter: ${id}`,
    );

    const referral = await this.findReferralOrFail(id, workspaceId);

    if (referral.status !== ReferralStatus.DRAFT) {
      throw new ConflictException(
        'Only draft referral letters can have their AI content regenerated. Current status: ' +
          referral.status,
      );
    }

    try {
      // Build all context needed for regeneration
      const patientContext = await this.buildPatientContextById(
        referral.patientId,
        workspaceId,
      );
      const mergedTranscript = referral.consultationId
        ? await this.getConsultationTranscriptContent(
            referral.consultationId,
            workspaceId,
          )
        : '';
      const patientInfo = await this.getPatientInfo(
        referral.patientId,
        workspaceId,
      );

      // Apply any overrides from dto before regeneration
      const effectiveUrgency = dto.urgency || referral.urgency;
      const effectiveReason =
        dto.reasonForReferral || referral.reasonForReferral;
      const effectiveClinicalSummary =
        dto.clinicalSummary || referral.clinicalHistory || '';
      const effectiveSpecialty =
        dto.referredToSpecialty || referral.specialty;

      const regenerationDto: CreateReferralLetterDto = {
        patientId: referral.patientId,
        consultationId: referral.consultationId || undefined,
        referralType: referral.metadata?.referralType || 'specialist',
        urgency: effectiveUrgency,
        clinicalSummary: effectiveClinicalSummary,
        reasonForReferral: effectiveReason,
        relevantHistory: referral.clinicalHistory || '',
        currentMedications: referral.currentMedications || '',
        investigationResults: referral.investigations || '',
        referredTo: dto.referredTo || referral.referredToName || '',
        referredToSpecialty: effectiveSpecialty,
      };

      const aiResult = await this.generateReferralContent(
        patientInfo,
        patientContext,
        mergedTranscript,
        regenerationDto,
        userId,
        workspaceId,
      );

      // Update the referral with regenerated content
      referral.additionalNotes = aiResult.finalLetter;
      if (aiResult.structuredContent) {
        referral.examinationFindings =
          aiResult.structuredContent.examinationSummary || referral.examinationFindings;
      }
      referral.metadata = {
        ...referral.metadata,
        aiGenerated: true,
        aiMetadata: aiResult.metadata,
        lastRegeneratedAt: new Date().toISOString(),
        regenerationTrigger: 'force_regenerate',
        regenerationCount:
          (referral.metadata?.regenerationCount || 0) + 1,
      };

      const updated = await this.referralRepository.save(referral);

      await this.logAuditEvent(
        AuditEventType.UPDATE,
        AuditOutcome.SUCCESS,
        'ReferralLetter',
        id,
        userId,
        workspaceId,
        'Force regenerated referral letter AI content',
        {
          action: 'regenerate',
          tokensUsed: aiResult.metadata?.tokensUsed || 0,
          regenerationCount: referral.metadata?.regenerationCount || 1,
        },
      );

      this.logger.log(
        `[${operationId}] Referral letter AI content regenerated successfully: ${id}`,
      );
      return this.mapReferralToResponse(updated);
    } catch (error) {
      this.logger.error(
        `[${operationId}] Failed to regenerate referral letter AI content: ${this.extractErrorMessage(error)}`,
        this.extractErrorStack(error),
      );

      await this.logAuditEvent(
        AuditEventType.UPDATE,
        AuditOutcome.FAILURE,
        'ReferralLetter',
        id,
        userId,
        workspaceId,
        'Failed to regenerate referral letter AI content',
        { error: this.extractErrorMessage(error) },
      );

      throw new InternalServerErrorException(
        'Failed to regenerate referral letter content. Please try again.',
      );
    }
  }

  /**
   * Force regenerate the AI content for a sick note.
   * Unlike updateSickNoteContent, this does not update manual fields
   * but only re-generates the AI portion using current data.
   *
   * @param id - The sick note ID
   * @param dto - Optional overrides for the regeneration context
   * @param userId - The user requesting regeneration
   * @param workspaceId - The workspace for multi-tenant isolation
   * @returns The sick note with regenerated AI content
   */
  async regenerateSickNoteContent(
    id: string,
    dto: Partial<UpdateSickNoteDto>,
    userId: string,
    workspaceId: string,
  ): Promise<SickNoteResponseDto> {
    const operationId = `regen_sicknote_${Date.now()}`;
    this.logger.log(
      `[${operationId}] Force regenerating AI content for sick note: ${id}`,
    );

    const sickNote = await this.findSickNoteOrFail(id, workspaceId);

    if (sickNote.status !== SickNoteStatus.DRAFT) {
      throw new ConflictException(
        'Only draft sick notes can have their AI content regenerated. Current status: ' +
          sickNote.status,
      );
    }

    try {
      // Build all context needed for regeneration
      const patientContext = await this.buildPatientContextById(
        sickNote.patientId,
        workspaceId,
      );
      const mergedTranscript = sickNote.consultationId
        ? await this.getConsultationTranscriptContent(
            sickNote.consultationId,
            workspaceId,
          )
        : '';
      const patientInfo = await this.getPatientInfo(
        sickNote.patientId,
        workspaceId,
      );

      // Apply any overrides from dto
      const effectiveDiagnosis = dto.diagnosis || sickNote.diagnosis;
      const effectiveWorkRestriction =
        sickNote.isFitForLightDuties ? 'light_duty' : (sickNote.metadata?.workRestriction || 'full_rest');

      const regenerationDto: any = {
        patientId: sickNote.patientId,
        consultationId: sickNote.consultationId || undefined,
        diagnosis: effectiveDiagnosis,
        icd10Code: sickNote.metadata?.icd10Code || '',
        startDate: sickNote.startDate.toISOString().split('T')[0],
        endDate: sickNote.endDate.toISOString().split('T')[0],
        workRestriction: effectiveWorkRestriction,
        clinicalSummary: sickNote.recommendations || '',
        additionalNotes: sickNote.lightDutiesDescription || sickNote.metadata?.additionalNotes || '',
        treatmentPlan: sickNote.metadata?.treatmentPlan || '',
      };

      const aiResult = await this.generateSickNoteContent(
        patientInfo,
        patientContext,
        mergedTranscript,
        regenerationDto,
        userId,
        workspaceId,
      );

      // Update the sick note with regenerated content
      sickNote.recommendations = aiResult.finalLetter;
      sickNote.metadata = {
        ...sickNote.metadata,
        aiGenerated: true,
        aiMetadata: aiResult.metadata,
        lastRegeneratedAt: new Date().toISOString(),
        regenerationTrigger: 'force_regenerate',
        regenerationCount:
          (sickNote.metadata?.regenerationCount || 0) + 1,
      };

      const updated = await this.sickNoteRepository.save(sickNote);

      await this.logAuditEvent(
        AuditEventType.UPDATE,
        AuditOutcome.SUCCESS,
        'SickNote',
        id,
        userId,
        workspaceId,
        'Force regenerated sick note AI content',
        {
          action: 'regenerate',
          tokensUsed: aiResult.metadata?.tokensUsed || 0,
          regenerationCount: sickNote.metadata?.regenerationCount || 1,
        },
      );

      this.logger.log(
        `[${operationId}] Sick note AI content regenerated successfully: ${id}`,
      );
      return this.mapSickNoteToResponse(updated);
    } catch (error) {
      this.logger.error(
        `[${operationId}] Failed to regenerate sick note AI content: ${this.extractErrorMessage(error)}`,
        this.extractErrorStack(error),
      );

      await this.logAuditEvent(
        AuditEventType.UPDATE,
        AuditOutcome.FAILURE,
        'SickNote',
        id,
        userId,
        workspaceId,
        'Failed to regenerate sick note AI content',
        { error: this.extractErrorMessage(error) },
      );

      throw new InternalServerErrorException(
        'Failed to regenerate sick note content. Please try again.',
      );
    }
  }

  // ==========================================================================
  // SECTION 5: QUERY METHODS — By Patient
  // ==========================================================================

  /**
   * Get all referral letters for a specific patient with pagination.
   *
   * @param patientId - The patient ID
   * @param workspaceId - The workspace for multi-tenant isolation
   * @param options - Optional pagination parameters
   * @returns Paginated referral letter responses
   */
  async getPatientReferrals(
    patientId: string,
    workspaceId: string,
    options?: PaginationOptions,
  ): Promise<PaginatedResponseDto<ReferralLetterResponseDto>> {
    this.logger.debug(
      `Getting referral letters for patient: ${patientId}, workspace: ${workspaceId}`,
    );

    const page = options?.page || this.defaultPage;
    const limit = options?.limit || this.defaultLimit;

    try {
      const [referrals, total] = await this.referralRepository.findByPatient(
        patientId,
        workspaceId,
        page,
        limit,
      );

      const data = referrals.map((r) => this.mapReferralToResponse(r));

      return new PaginatedResponseDto(data, total, page, limit);
    } catch (error) {
      this.logger.error(
        `Failed to get patient referrals: ${this.extractErrorMessage(error)}`,
        this.extractErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * Get all sick notes for a specific patient with pagination.
   *
   * @param patientId - The patient ID
   * @param workspaceId - The workspace for multi-tenant isolation
   * @param options - Optional pagination parameters
   * @returns Paginated sick note responses
   */
  async getPatientSickNotes(
    patientId: string,
    workspaceId: string,
    options?: PaginationOptions,
  ): Promise<PaginatedResponseDto<SickNoteResponseDto>> {
    this.logger.debug(
      `Getting sick notes for patient: ${patientId}, workspace: ${workspaceId}`,
    );

    const page = options?.page || this.defaultPage;
    const limit = options?.limit || this.defaultLimit;

    try {
      const [sickNotes, total] = await this.sickNoteRepository.findByPatient(
        patientId,
        workspaceId,
        page,
        limit,
      );

      const data = sickNotes.map((s) => this.mapSickNoteToResponse(s));

      return new PaginatedResponseDto(data, total, page, limit);
    } catch (error) {
      this.logger.error(
        `Failed to get patient sick notes: ${this.extractErrorMessage(error)}`,
        this.extractErrorStack(error),
      );
      throw error;
    }
  }

  // ==========================================================================
  // SECTION 6: QUERY METHODS — By Consultation
  // ==========================================================================

  /**
   * Get all referral letters for a specific consultation with pagination.
   *
   * @param consultationId - The consultation ID
   * @param workspaceId - The workspace for multi-tenant isolation
   * @param options - Optional pagination parameters
   * @returns Paginated referral letter responses
   */
  async getReferralLettersByConsultation(
    consultationId: string,
    workspaceId: string,
    options?: PaginationOptions,
  ): Promise<PaginatedResponseDto<ReferralLetterResponseDto>> {
    this.logger.debug(
      `Getting referral letters for consultation: ${consultationId}`,
    );

    const page = options?.page || this.defaultPage;
    const limit = options?.limit || this.defaultLimit;
    const skip = (page - 1) * limit;

    try {
      const [referrals, total] = await this.referralRepository.findAndCount({
        where: {
          consultationId,
          workspaceId,
          deletedAt: IsNull(),
        },
        order: { createdAt: 'DESC' },
        skip,
        take: limit,
      });

      const data = referrals.map((r) => this.mapReferralToResponse(r));

      return new PaginatedResponseDto(data, total, page, limit);
    } catch (error) {
      this.logger.error(
        `Failed to get consultation referral letters: ${this.extractErrorMessage(error)}`,
        this.extractErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * Get all sick notes for a specific consultation with pagination.
   *
   * @param consultationId - The consultation ID
   * @param workspaceId - The workspace for multi-tenant isolation
   * @param options - Optional pagination parameters
   * @returns Paginated sick note responses
   */
  async getSickNotesByConsultation(
    consultationId: string,
    workspaceId: string,
    options?: PaginationOptions,
  ): Promise<PaginatedResponseDto<SickNoteResponseDto>> {
    this.logger.debug(
      `Getting sick notes for consultation: ${consultationId}`,
    );

    const page = options?.page || this.defaultPage;
    const limit = options?.limit || this.defaultLimit;
    const skip = (page - 1) * limit;

    try {
      const [sickNotes, total] = await this.sickNoteRepository.findAndCount({
        where: {
          consultationId,
          workspaceId,
          deletedAt: IsNull(),
        },
        order: { createdAt: 'DESC' },
        skip,
        take: limit,
      });

      const data = sickNotes.map((s) => this.mapSickNoteToResponse(s));

      return new PaginatedResponseDto(data, total, page, limit);
    } catch (error) {
      this.logger.error(
        `Failed to get consultation sick notes: ${this.extractErrorMessage(error)}`,
        this.extractErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * Get all letters (referrals + sick notes) for a specific consultation.
   * Returns both types in a combined result object.
   *
   * @param consultationId - The consultation ID
   * @param workspaceId - The workspace for multi-tenant isolation
   * @param options - Optional pagination parameters (applied to each type independently)
   * @returns Combined letters result with both referrals and sick notes
   */
  async getAllLettersByConsultation(
    consultationId: string,
    workspaceId: string,
    options?: PaginationOptions,
  ): Promise<CombinedLettersResult> {
    this.logger.debug(
      `Getting all letters for consultation: ${consultationId}`,
    );

    const page = options?.page || this.defaultPage;
    const limit = options?.limit || this.defaultLimit;
    const skip = (page - 1) * limit;

    try {
      // Fetch both in parallel for efficiency
      const [referralResult, sickNoteResult] = await Promise.all([
        this.referralRepository.findAndCount({
          where: {
            consultationId,
            workspaceId,
            deletedAt: IsNull(),
          },
          order: { createdAt: 'DESC' },
          skip,
          take: limit,
        }),
        this.sickNoteRepository.findAndCount({
          where: {
            consultationId,
            workspaceId,
            deletedAt: IsNull(),
          },
          order: { createdAt: 'DESC' },
          skip,
          take: limit,
        }),
      ]);

      const [referrals, totalReferrals] = referralResult;
      const [sickNotes, totalSickNotes] = sickNoteResult;

      return {
        referralLetters: referrals.map((r) => this.mapReferralToResponse(r)),
        sickNotes: sickNotes.map((s) => this.mapSickNoteToResponse(s)),
        totalReferrals,
        totalSickNotes,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get all consultation letters: ${this.extractErrorMessage(error)}`,
        this.extractErrorStack(error),
      );
      throw error;
    }
  }

  // ==========================================================================
  // SECTION 7: SINGLE ENTITY RETRIEVAL
  // ==========================================================================

  /**
   * Get a single referral letter by ID with relations loaded.
   *
   * @param letterId - The referral letter ID
   * @param workspaceId - The workspace for multi-tenant isolation
   * @returns The referral letter response
   */
  async getReferralLetterById(
    letterId: string,
    workspaceId: string,
  ): Promise<ReferralLetterResponseDto> {
    this.logger.debug(`Getting referral letter by ID: ${letterId}`);

    const referral = await this.referralRepository.findOne({
      where: { id: letterId, workspaceId, deletedAt: IsNull() },
      relations: ['note'],
    });

    if (!referral) {
      throw new NotFoundException(
        `Referral letter not found: ${letterId}`,
      );
    }

    return this.mapReferralToResponse(referral);
  }

  /**
   * Get a single sick note by ID with relations loaded.
   *
   * @param noteId - The sick note ID
   * @param workspaceId - The workspace for multi-tenant isolation
   * @returns The sick note response
   */
  async getSickNoteById(
    noteId: string,
    workspaceId: string,
  ): Promise<SickNoteResponseDto> {
    this.logger.debug(`Getting sick note by ID: ${noteId}`);

    const sickNote = await this.sickNoteRepository.findOne({
      where: { id: noteId, workspaceId, deletedAt: IsNull() },
      relations: ['note'],
    });

    if (!sickNote) {
      throw new NotFoundException(`Sick note not found: ${noteId}`);
    }

    return this.mapSickNoteToResponse(sickNote);
  }

  // ==========================================================================
  // SECTION 8: UTILITY METHODS
  // ==========================================================================

  /**
   * Check whether a consultation has any associated letters
   * (referral letters or sick notes).
   *
   * @param consultationId - The consultation ID
   * @param workspaceId - The workspace for multi-tenant isolation
   * @returns True if the consultation has at least one letter
   */
  async consultationHasLetters(
    consultationId: string,
    workspaceId: string,
  ): Promise<boolean> {
    this.logger.debug(
      `Checking if consultation has letters: ${consultationId}`,
    );

    try {
      const [referralCount, sickNoteCount] = await Promise.all([
        this.referralRepository.count({
          where: {
            consultationId,
            workspaceId,
            deletedAt: IsNull(),
          },
        }),
        this.sickNoteRepository.count({
          where: {
            consultationId,
            workspaceId,
            deletedAt: IsNull(),
          },
        }),
      ]);

      return referralCount > 0 || sickNoteCount > 0;
    } catch (error) {
      this.logger.error(
        `Failed to check consultation letters: ${this.extractErrorMessage(error)}`,
        this.extractErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * Health check for the letter generation service.
   * Verifies database connectivity and AI service availability.
   *
   * @returns Health check result with service status details
   */
  async healthCheck(): Promise<HealthCheckResult> {
    this.logger.debug('Performing letter generation service health check');

    const result: HealthCheckResult = {
      service: 'LetterGenerationService',
      healthy: true,
      aiService: { healthy: false, details: 'Not checked' },
      database: { healthy: false, details: 'Not checked' },
      timestamp: new Date().toISOString(),
    };

    // Check AI service health
    try {
      const aiHealth = await this.letterAiService.healthCheck();
      result.aiService = aiHealth;
    } catch (error) {
      result.aiService = {
        healthy: false,
        details: `AI service health check failed: ${this.extractErrorMessage(error)}`,
      };
    }

    // Check database connectivity
    try {
      // Simple query to verify database connectivity
      await this.referralRepository.count({
        where: { deletedAt: IsNull() },
        take: 1,
      } as any);
      result.database = {
        healthy: true,
        details: 'Database connection operational',
      };
    } catch (error) {
      result.database = {
        healthy: false,
        details: `Database health check failed: ${this.extractErrorMessage(error)}`,
      };
    }

    // Overall health is true only if all subsystems are healthy
    result.healthy = result.aiService.healthy && result.database.healthy;

    this.logger.log(
      `Health check completed: ${result.healthy ? 'HEALTHY' : 'UNHEALTHY'}`,
    );

    return result;
  }

  // ==========================================================================
  // SECTION 9: PRIVATE HELPERS — AI Content Generation
  // ==========================================================================

  /**
   * Generate referral letter content using the AI service.
   * Constructs the prompt context from patient info, history, and transcript,
   * then delegates to LetterAiGenerationService.
   *
   * @param patientInfo - Basic patient information
   * @param patientContext - Comprehensive patient history string
   * @param transcript - Merged consultation transcript
   * @param dto - The referral letter creation parameters
   * @returns AI generation result with final letter and metadata
   */
  private async generateReferralContent(
    patientInfo: { fullName: string; age: string; gender: string; fileNumber?: string; dateOfBirth: string },
    patientContext: string,
    transcript: string,
    dto: GenerateReferralLetterDto | CreateReferralLetterDto,
    userId?: string,
    workspaceId?: string,
  ): Promise<{ finalLetter: string; structuredContent?: any; metadata?: any }> {
    this.logger.debug('Generating AI referral content');
    const startTime = Date.now();

    const result = await this.letterAiService.generateReferralLetter({
      patient: patientInfo,
      comprehensivePatientHistory: patientContext,
      comprehensiveTranscript: transcript || 'No consultation transcript available.',
      // AI fills in clinical summary and reason for referral from care note when not provided
      clinicalSummary: dto.clinicalSummary || 'Extract from the care note and patient history provided.',
      examinationFindings: dto.investigationsPerformed || '',
      investigationResults: dto.investigationResults || '',
      treatmentToDate: dto.currentMedications || '',
      reasonForReferral: dto.reasonForReferral || 'Extract from the care note and patient history provided.',
      referralType: this.mapStringToReferralType(dto.referralType),
      urgency: dto.urgency,
      referredToService: dto.referredToSpecialty || 'General',
      referredToClinician: dto.referredTo || '',
      referredToFacility: dto.referredTo || '',
      requiresAppointment: !!dto.appointmentDate,
      preferredAppointmentDate: dto.appointmentDate
        ? new Date(dto.appointmentDate)
        : undefined,
    });

    // Report AI usage to portal for billing
    if (userId && workspaceId) {
      this.reportLetterAiUsage(userId, workspaceId, AiOperation.LETTER_GENERATION,
        result.metadata?.model ?? 'gpt-4o', result.metadata?.tokensUsed ?? 0, Date.now() - startTime,
        AiUsageStatus.COMPLETED);
    }

    return result;
  }

  /**
   * Generate sick note content using the AI service.
   * Constructs the prompt context from patient info, history, and transcript,
   * then delegates to LetterAiGenerationService.
   *
   * @param patientInfo - Basic patient information
   * @param patientContext - Comprehensive patient history string
   * @param transcript - Merged consultation transcript
   * @param dto - The sick note creation parameters
   * @returns AI generation result with final letter and metadata
   */
  private async generateSickNoteContent(
    patientInfo: { fullName: string; age: string; gender: string; fileNumber?: string; dateOfBirth: string },
    patientContext: string,
    transcript: string,
    dto: any,
    userId?: string,
    workspaceId?: string,
  ): Promise<{ finalLetter: string; structuredContent?: any; metadata?: any }> {
    this.logger.debug('Generating AI sick note content');
    const startTime = Date.now();

    const result = await this.letterAiService.generateSickNote({
      patient: patientInfo,
      comprehensivePatientHistory: patientContext,
      comprehensiveTranscript: transcript || 'No consultation transcript available.',
      diagnosis: dto.diagnosis,
      icd10Code: dto.icd10Code || '',
      clinicalSummary: dto.clinicalSummary || '',
      startDate: dto.startDate,
      endDate: dto.endDate,
      workRestriction: this.mapStringToWorkRestriction(dto.workRestriction),
      requiresFollowUp: false,
      isHospitalized: false,
    });

    // Report AI usage to portal for billing
    if (userId && workspaceId) {
      this.reportLetterAiUsage(userId, workspaceId, AiOperation.LETTER_GENERATION,
        result.metadata?.model ?? 'gpt-4o', result.metadata?.tokensUsed ?? 0, Date.now() - startTime,
        AiUsageStatus.COMPLETED);
    }

    return result;
  }

  /**
   * Generate extension content using the AI service.
   * Used by extendSickNote for AI-powered extension letters.
   *
   * @param originalNote - The original sick note being extended
   * @param newEndDate - The new end date for the extension
   * @param patientInfo - Basic patient information
   * @param patientContext - Comprehensive patient history string
   * @param transcript - Merged consultation transcript
   * @returns AI generation result with final letter and metadata
   */
  private async generateExtensionContent(
    originalNote: SickNote,
    newEndDate: Date,
    patientInfo: { fullName: string; age: string; gender: string; fileNumber?: string; dateOfBirth: string },
    patientContext: string,
    transcript: string,
    userId?: string,
    workspaceId?: string,
  ): Promise<{ finalLetter: string; metadata?: any }> {
    this.logger.debug(
      `Generating AI extension content for note: ${originalNote.id}`,
    );
    const startTime = Date.now();

    const result = await this.letterAiService.generateSickNoteExtension({
      patient: patientInfo,
      comprehensivePatientHistory: patientContext,
      comprehensiveTranscript: transcript || 'No consultation transcript available.',
      originalDiagnosis: originalNote.diagnosis,
      originalIcd10Code: originalNote.metadata?.icd10Code || '',
      originalClinicalSummary: originalNote.recommendations || '',
      originalStartDate: originalNote.startDate.toISOString().split('T')[0],
      originalEndDate: originalNote.endDate.toISOString().split('T')[0],
      workRestriction: this.mapStringToWorkRestriction(
        originalNote.metadata?.workRestriction,
      ),
      specificRestrictions: originalNote.lightDutiesDescription || '',
      newEndDate: newEndDate.toISOString().split('T')[0],
      extensionReason:
        'Continuation of medical condition requiring ongoing work restriction',
    });

    // Report AI usage to portal for billing
    if (userId && workspaceId) {
      this.reportLetterAiUsage(userId, workspaceId, AiOperation.LETTER_GENERATION,
        result.metadata?.model ?? 'gpt-4o', result.metadata?.tokensUsed ?? 0, Date.now() - startTime,
        AiUsageStatus.COMPLETED);
    }

    return result;
  }

  // ==========================================================================
  // SECTION 10: PRIVATE HELPERS — Patient Context Building
  // ==========================================================================

  /**
   * Build a comprehensive patient context string for AI generation.
   * Queries the patient's medical records directly using DataSource since
   * the Patients domain module is not yet available as a dependency.
   *
   * The context includes:
   * - Demographics (name, age, gender, date of birth, file number)
   * - Active allergies and intolerances
   * - Current medications
   * - Medical history (chronic conditions, past diagnoses)
   * - Surgical history
   * - Family medical history
   * - Social history (smoking, alcohol, occupation)
   *
   * @param patientId - The patient ID
   * @param workspaceId - The workspace for multi-tenant isolation
   * @returns Comprehensive patient context string for AI prompts
   */
  private async buildPatientContextById(
    patientId: string,
    workspaceId: string,
  ): Promise<string> {
    this.logger.debug(
      `Building patient context for patient: ${patientId}, workspace: ${workspaceId}`,
    );

    try {
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();

      try {
        // TODO: Replace with proper Patients domain service when available
        // Fetch patient demographics
        const patient = await queryRunner.query(
          `SELECT * FROM patients WHERE id = $1 AND "workspaceId" = $2 LIMIT 1`,
          [patientId, workspaceId],
        );

        if (!patient || patient.length === 0) {
          this.logger.warn(
            `Patient not found for context building: ${patientId}`,
          );
          return 'Patient information not available.';
        }

        const p = patient[0];
        const sections: string[] = [];

        // Demographics
        sections.push('=== PATIENT DEMOGRAPHICS ===');
        sections.push(`Name: ${p.firstName || ''} ${p.lastName || ''}`);
        sections.push(`Date of Birth: ${p.dateOfBirth || 'N/A'}`);
        sections.push(`Age: ${this.calculateAge(p.dateOfBirth)}`);
        sections.push(`Gender: ${p.gender || 'N/A'}`);
        sections.push(`File Number: ${p.fileNumber || p.id || 'N/A'}`);
        if (p.idNumber) sections.push(`ID Number: ${p.idNumber}`);

        // TODO: Replace with proper Patients domain service when available
        // Fetch allergies
        try {
          const allergies = await queryRunner.query(
            `SELECT * FROM patient_allergies WHERE "patientId" = $1 AND "workspaceId" = $2 AND "deletedAt" IS NULL`,
            [patientId, workspaceId],
          );

          if (allergies && allergies.length > 0) {
            sections.push('\n=== ALLERGIES & INTOLERANCES ===');
            allergies.forEach((allergy: any) => {
              const severity = allergy.severity ? ` (${allergy.severity})` : '';
              const reaction = allergy.reaction
                ? ` - Reaction: ${allergy.reaction}`
                : '';
              sections.push(
                `- ${allergy.allergen || allergy.name || 'Unknown'}${severity}${reaction}`,
              );
            });
          } else {
            sections.push('\n=== ALLERGIES & INTOLERANCES ===');
            sections.push('No known allergies recorded.');
          }
        } catch {
          sections.push('\n=== ALLERGIES & INTOLERANCES ===');
          sections.push('Allergy information not available.');
        }

        // TODO: Replace with proper Patients domain service when available
        // Fetch current medications
        try {
          const medications = await queryRunner.query(
            `SELECT * FROM patient_medications WHERE "patientId" = $1 AND "workspaceId" = $2 AND "deletedAt" IS NULL AND status = 'active'`,
            [patientId, workspaceId],
          );

          if (medications && medications.length > 0) {
            sections.push('\n=== CURRENT MEDICATIONS ===');
            medications.forEach((med: any) => {
              const dosage = med.dosage ? ` ${med.dosage}` : '';
              const frequency = med.frequency ? ` ${med.frequency}` : '';
              sections.push(
                `- ${med.medicationName || med.name || 'Unknown'}${dosage}${frequency}`,
              );
            });
          } else {
            sections.push('\n=== CURRENT MEDICATIONS ===');
            sections.push('No current medications recorded.');
          }
        } catch {
          sections.push('\n=== CURRENT MEDICATIONS ===');
          sections.push('Medication information not available.');
        }

        // TODO: Replace with proper Patients domain service when available
        // Fetch medical history
        try {
          const medicalHistory = await queryRunner.query(
            `SELECT * FROM patient_medical_history WHERE "patientId" = $1 AND "workspaceId" = $2 AND "deletedAt" IS NULL ORDER BY "diagnosisDate" DESC`,
            [patientId, workspaceId],
          );

          if (medicalHistory && medicalHistory.length > 0) {
            sections.push('\n=== MEDICAL HISTORY ===');
            medicalHistory.forEach((entry: any) => {
              const date = entry.diagnosisDate
                ? ` (${new Date(entry.diagnosisDate).toISOString().split('T')[0]})`
                : '';
              const status = entry.status ? ` [${entry.status}]` : '';
              sections.push(
                `- ${entry.condition || entry.diagnosis || 'Unknown'}${date}${status}`,
              );
              if (entry.notes) {
                sections.push(`  Notes: ${entry.notes}`);
              }
            });
          } else {
            sections.push('\n=== MEDICAL HISTORY ===');
            sections.push('No medical history recorded.');
          }
        } catch {
          sections.push('\n=== MEDICAL HISTORY ===');
          sections.push('Medical history information not available.');
        }

        // TODO: Replace with proper Patients domain service when available
        // Fetch surgical history
        try {
          const surgicalHistory = await queryRunner.query(
            `SELECT * FROM patient_surgical_history WHERE "patientId" = $1 AND "workspaceId" = $2 AND "deletedAt" IS NULL ORDER BY "surgeryDate" DESC`,
            [patientId, workspaceId],
          );

          if (surgicalHistory && surgicalHistory.length > 0) {
            sections.push('\n=== SURGICAL HISTORY ===');
            surgicalHistory.forEach((entry: any) => {
              const date = entry.surgeryDate
                ? ` (${new Date(entry.surgeryDate).toISOString().split('T')[0]})`
                : '';
              sections.push(
                `- ${entry.procedure || entry.surgery || 'Unknown'}${date}`,
              );
              if (entry.outcome) {
                sections.push(`  Outcome: ${entry.outcome}`);
              }
              if (entry.complications) {
                sections.push(`  Complications: ${entry.complications}`);
              }
            });
          } else {
            sections.push('\n=== SURGICAL HISTORY ===');
            sections.push('No surgical history recorded.');
          }
        } catch {
          sections.push('\n=== SURGICAL HISTORY ===');
          sections.push('Surgical history information not available.');
        }

        // TODO: Replace with proper Patients domain service when available
        // Fetch family history
        try {
          const familyHistory = await queryRunner.query(
            `SELECT * FROM patient_family_history WHERE "patientId" = $1 AND "workspaceId" = $2 AND "deletedAt" IS NULL`,
            [patientId, workspaceId],
          );

          if (familyHistory && familyHistory.length > 0) {
            sections.push('\n=== FAMILY HISTORY ===');
            familyHistory.forEach((entry: any) => {
              const relation = entry.relationship
                ? ` (${entry.relationship})`
                : '';
              sections.push(
                `- ${entry.condition || 'Unknown condition'}${relation}`,
              );
              if (entry.notes) {
                sections.push(`  Notes: ${entry.notes}`);
              }
            });
          } else {
            sections.push('\n=== FAMILY HISTORY ===');
            sections.push('No family history recorded.');
          }
        } catch {
          sections.push('\n=== FAMILY HISTORY ===');
          sections.push('Family history information not available.');
        }

        // TODO: Replace with proper Patients domain service when available
        // Fetch social history
        try {
          const socialHistory = await queryRunner.query(
            `SELECT * FROM patient_social_history WHERE "patientId" = $1 AND "workspaceId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
            [patientId, workspaceId],
          );

          if (socialHistory && socialHistory.length > 0) {
            const sh = socialHistory[0];
            sections.push('\n=== SOCIAL HISTORY ===');
            if (sh.smokingStatus) {
              sections.push(`Smoking Status: ${sh.smokingStatus}`);
            }
            if (sh.alcoholUse) {
              sections.push(`Alcohol Use: ${sh.alcoholUse}`);
            }
            if (sh.drugUse) {
              sections.push(`Drug Use: ${sh.drugUse}`);
            }
            if (sh.occupation) {
              sections.push(`Occupation: ${sh.occupation}`);
            }
            if (sh.exerciseFrequency) {
              sections.push(`Exercise: ${sh.exerciseFrequency}`);
            }
            if (sh.dietaryRestrictions) {
              sections.push(`Dietary: ${sh.dietaryRestrictions}`);
            }
            if (sh.notes) {
              sections.push(`Notes: ${sh.notes}`);
            }
          } else {
            sections.push('\n=== SOCIAL HISTORY ===');
            sections.push('No social history recorded.');
          }
        } catch {
          sections.push('\n=== SOCIAL HISTORY ===');
          sections.push('Social history information not available.');
        }

        return sections.join('\n');
      } finally {
        await queryRunner.release();
      }
    } catch (error) {
      this.logger.error(
        `Failed to build patient context: ${this.extractErrorMessage(error)}`,
        this.extractErrorStack(error),
      );
      return 'Patient context could not be built due to a system error.';
    }
  }

  /**
   * Build the patient context string from a patient object.
   * This is the public-facing version that accepts a patient object directly.
   * Useful when the patient data is already loaded.
   *
   * @param patient - The patient data object
   * @returns Comprehensive patient context string
   */
  private buildPatientContext(patient: any): string {
    if (!patient) {
      return 'Patient information not available.';
    }

    const sections: string[] = [];

    sections.push('=== PATIENT DEMOGRAPHICS ===');
    sections.push(
      `Name: ${patient.firstName || ''} ${patient.lastName || ''}`,
    );
    sections.push(`Date of Birth: ${patient.dateOfBirth || 'N/A'}`);
    sections.push(`Age: ${this.calculateAge(patient.dateOfBirth)}`);
    sections.push(`Gender: ${patient.gender || 'N/A'}`);
    sections.push(`File Number: ${patient.fileNumber || patient.id || 'N/A'}`);

    if (patient.allergies && patient.allergies.length > 0) {
      sections.push('\n=== ALLERGIES & INTOLERANCES ===');
      patient.allergies.forEach((allergy: any) => {
        const severity = allergy.severity ? ` (${allergy.severity})` : '';
        sections.push(
          `- ${allergy.allergen || allergy.name || 'Unknown'}${severity}`,
        );
      });
    }

    if (patient.medications && patient.medications.length > 0) {
      sections.push('\n=== CURRENT MEDICATIONS ===');
      patient.medications.forEach((med: any) => {
        const dosage = med.dosage ? ` ${med.dosage}` : '';
        sections.push(
          `- ${med.medicationName || med.name || 'Unknown'}${dosage}`,
        );
      });
    }

    if (patient.medicalHistory && patient.medicalHistory.length > 0) {
      sections.push('\n=== MEDICAL HISTORY ===');
      patient.medicalHistory.forEach((entry: any) => {
        sections.push(`- ${entry.condition || entry.diagnosis || 'Unknown'}`);
      });
    }

    if (patient.surgicalHistory && patient.surgicalHistory.length > 0) {
      sections.push('\n=== SURGICAL HISTORY ===');
      patient.surgicalHistory.forEach((entry: any) => {
        sections.push(`- ${entry.procedure || entry.surgery || 'Unknown'}`);
      });
    }

    if (patient.familyHistory && patient.familyHistory.length > 0) {
      sections.push('\n=== FAMILY HISTORY ===');
      patient.familyHistory.forEach((entry: any) => {
        const relation = entry.relationship
          ? ` (${entry.relationship})`
          : '';
        sections.push(
          `- ${entry.condition || 'Unknown'}${relation}`,
        );
      });
    }

    if (patient.socialHistory) {
      const sh = patient.socialHistory;
      sections.push('\n=== SOCIAL HISTORY ===');
      if (sh.smokingStatus) sections.push(`Smoking: ${sh.smokingStatus}`);
      if (sh.alcoholUse) sections.push(`Alcohol: ${sh.alcoholUse}`);
      if (sh.occupation) sections.push(`Occupation: ${sh.occupation}`);
    }

    return sections.join('\n');
  }

  // ==========================================================================
  // SECTION 11: PRIVATE HELPERS — Transcript Merging
  // ==========================================================================

  /**
   * Merge structured transcripts for a consultation into a single string
   * with timestamps separating each transcript segment.
   *
   * @param transcripts - Array of RecordingsTranscript entities
   * @returns Merged transcript string with timestamps
   */
  private mergeStructuredTranscripts(
    transcripts: RecordingsTranscript[],
  ): string {
    if (!transcripts || transcripts.length === 0) {
      return '';
    }

    // Sort by creation date (oldest first for chronological ordering)
    const sorted = [...transcripts].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    const sections: string[] = [];

    sorted.forEach((transcript, index) => {
      const timestamp = new Date(transcript.createdAt).toISOString();
      const separator = '='.repeat(60);

      sections.push(separator);
      sections.push(
        `--- Consultation Transcript ${index + 1} of ${sorted.length} ---`,
      );
      sections.push(`--- Recorded: ${timestamp} ---`);
      sections.push(`--- AI Provider: ${transcript.aiProvider} ---`);
      sections.push(`--- Model: ${transcript.modelUsed} ---`);
      sections.push(separator);

      // Prefer structured transcript over raw transcribed text
      const content =
        transcript.structuredTranscript || transcript.transcribedText || '';
      sections.push(content);
      sections.push(''); // Blank line between sections
    });

    return sections.join('\n');
  }

  /**
   * Fetch and merge consultation transcripts for a given consultation.
   * Uses the RecordingsTranscriptRepository to get all transcripts
   * for the consultation, then merges them chronologically.
   *
   * @param consultationId - The consultation ID
   * @param workspaceId - The workspace for multi-tenant isolation
   * @returns Merged transcript content string
   */
  private async getConsultationTranscriptContent(
    consultationId: string,
    workspaceId: string,
  ): Promise<string> {
    this.logger.debug(
      `Fetching transcripts for consultation: ${consultationId}`,
    );

    try {
      const [transcripts] = await this.transcriptRepository.findByConsultation(
        consultationId,
        workspaceId,
        1,
        100, // Fetch up to 100 transcripts for a single consultation
      );

      if (!transcripts || transcripts.length === 0) {
        this.logger.debug(
          `No transcripts found for consultation: ${consultationId}`,
        );
        return '';
      }

      this.logger.debug(
        `Found ${transcripts.length} transcripts for consultation: ${consultationId}`,
      );

      return this.mergeStructuredTranscripts(transcripts);
    } catch (error) {
      this.logger.warn(
        `Failed to fetch transcripts for consultation ${consultationId}: ${this.extractErrorMessage(error)}`,
      );
      return '';
    }
  }

  // ==========================================================================
  // SECTION 12: PRIVATE HELPERS — Care Note Content
  // ==========================================================================

  /**
   * Fetch a care note's content and serialize it to a flat text string for AI prompts.
   * Used when the doctor triggers AI generation from a specific note card.
   *
   * @param noteId - The care note UUID
   * @param workspaceId - The workspace for multi-tenant isolation
   * @returns Serialized note content string, or empty string if not found
   */
  private async fetchCareNoteContent(noteId: string, workspaceId: string): Promise<string> {
    this.logger.debug(`Fetching care note content for AI: ${noteId}`);

    try {
      // Use the repository so content is AES-256 decrypted before we read it
      const note = await this.careNoteRepository.findOne({
        where: { id: noteId, workspaceId, deletedAt: IsNull() },
      });

      if (!note || !note.content) {
        this.logger.warn(`Care note not found or has no content: ${noteId}`);
        return '';
      }

      // content is stored as JSON string (encrypted at rest, decrypted by EncryptedRepository)
      let contentObj: Record<string, any>;
      try {
        contentObj = JSON.parse(note.content);
      } catch {
        // Not valid JSON — return the raw decrypted string as-is
        return note.content;
      }

      if (typeof contentObj !== 'object' || Array.isArray(contentObj)) return '';

      // Serialize JSON content to human-readable text for the AI prompt
      const SKIP = new Set(['vitals', 'treatmentPlan', 'treatmentPrescriptions', 'type']);
      const lines: string[] = [
        `Note Type: ${note.type || 'Clinical Note'}`,
        `Date: ${note.createdAt instanceof Date ? note.createdAt.toISOString() : String(note.createdAt ?? 'N/A')}`,
      ];

      for (const [key, value] of Object.entries(contentObj)) {
        if (SKIP.has(key) || value === null || value === undefined || value === '') continue;

        const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();

        if (typeof value === 'string') {
          lines.push(`${label}: ${value}`);
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          lines.push(`${label}: ${value}`);
        } else if (Array.isArray(value) && value.length) {
          lines.push(`${label}:\n${value.map(v => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join('\n')}`);
        } else if (typeof value === 'object') {
          const inner = Object.entries(value as Record<string, any>)
            .filter(([, v]) => v !== null && v !== undefined && v !== '')
            .map(([k, v]) => `  ${k}: ${v}`)
            .join('\n');
          if (inner) lines.push(`${label}:\n${inner}`);
        }
      }

      return lines.join('\n');
    } catch (error) {
      this.logger.warn(`Failed to fetch care note content ${noteId}: ${this.extractErrorMessage(error)}`);
      return '';
    }
  }

  // ==========================================================================
  // SECTION 13: PRIVATE HELPERS — Patient Info
  // ==========================================================================

  /**
   * Get basic patient information for AI prompts.
   * Queries the patients table directly since the Patients domain
   * is not yet available as a dependency.
   *
   * @param patientId - The patient ID
   * @param workspaceId - The workspace for multi-tenant isolation
   * @returns Patient info object for AI generation context
   */
  private async getPatientInfo(
    patientId: string,
    workspaceId: string,
  ): Promise<{
    fullName: string;
    age: string;
    gender: string;
    fileNumber?: string;
    dateOfBirth: string;
  }> {
    try {
      // TODO: Replace with proper Patients domain service when available
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();

      try {
        const result = await queryRunner.query(
          `SELECT "firstName", "lastName", "dateOfBirth", gender, "fileNumber" FROM patients WHERE id = $1 AND "workspaceId" = $2 LIMIT 1`,
          [patientId, workspaceId],
        );

        if (result && result.length > 0) {
          const p = result[0];
          return {
            fullName: `${p.firstName || ''} ${p.lastName || ''}`.trim(),
            age: this.calculateAge(p.dateOfBirth),
            gender: p.gender || 'Unknown',
            fileNumber: p.fileNumber || undefined,
            dateOfBirth: p.dateOfBirth
              ? new Date(p.dateOfBirth).toISOString().split('T')[0]
              : 'Unknown',
          };
        }
      } finally {
        await queryRunner.release();
      }
    } catch (error) {
      this.logger.warn(
        `Failed to get patient info for ${patientId}: ${this.extractErrorMessage(error)}`,
      );
    }

    // Fallback if patient not found or query fails
    return {
      fullName: 'Patient',
      age: 'Unknown',
      gender: 'Unknown',
      dateOfBirth: 'Unknown',
    };
  }

  // ==========================================================================
  // SECTION 13: PRIVATE HELPERS — Entity Lookups
  // ==========================================================================

  /**
   * Find a referral letter by ID and workspace, or throw NotFoundException.
   *
   * @param id - The referral letter ID
   * @param workspaceId - The workspace for multi-tenant isolation
   * @returns The found referral letter entity
   * @throws NotFoundException if not found
   */
  private async findReferralOrFail(
    id: string,
    workspaceId: string,
  ): Promise<ReferralLetter> {
    const referral = await this.referralRepository.findOne({
      where: { id, workspaceId, deletedAt: IsNull() },
    });

    if (!referral) {
      throw new NotFoundException(`Referral letter not found: ${id}`);
    }

    return referral;
  }

  /**
   * Find a sick note by ID and workspace, or throw NotFoundException.
   *
   * @param id - The sick note ID
   * @param workspaceId - The workspace for multi-tenant isolation
   * @returns The found sick note entity
   * @throws NotFoundException if not found
   */
  private async findSickNoteOrFail(
    id: string,
    workspaceId: string,
  ): Promise<SickNote> {
    const sickNote = await this.sickNoteRepository.findOne({
      where: { id, workspaceId, deletedAt: IsNull() },
    });

    if (!sickNote) {
      throw new NotFoundException(`Sick note not found: ${id}`);
    }

    return sickNote;
  }

  // ==========================================================================
  // SECTION 14: PRIVATE HELPERS — Response Mapping
  // ==========================================================================

  /**
   * Map a ReferralLetter entity to a ReferralLetterResponseDto.
   * Computes permission flags (canEdit, canIssue, canSend) based on status.
   *
   * @param referral - The referral letter entity
   * @returns The referral letter response DTO
   */
  private mapReferralToResponse(
    referral: ReferralLetter,
  ): ReferralLetterResponseDto {
    const canEdit = referral.status === ReferralStatus.DRAFT;
    const canIssue = referral.status === ReferralStatus.DRAFT;
    const canSend =
      referral.status !== ReferralStatus.DRAFT &&
      referral.status !== ReferralStatus.CANCELLED;

    // Map entity fields to DTO fields
    const response: ReferralLetterResponseDto = {
      id: referral.id,
      workspaceId: referral.workspaceId,
      patientId: referral.patientId,
      consultationId: referral.consultationId || undefined,
      doctorId: referral.referringDoctorId,
      referralType: referral.metadata?.referralType || referral.specialty || 'specialist',
      urgency: referral.urgency,
      clinicalSummary: referral.clinicalHistory || '',
      reasonForReferral: referral.reasonForReferral,
      relevantHistory: referral.clinicalHistory || undefined,
      currentMedications: referral.currentMedications || undefined,
      allergies: referral.metadata?.allergies || undefined,
      investigationsPerformed: referral.examinationFindings || undefined,
      investigationResults: referral.investigations || undefined,
      provisionalDiagnosis: referral.metadata?.provisionalDiagnosis || undefined,
      referredTo: referral.referredToName || undefined,
      referredToSpecialty: referral.specialty || undefined,
      appointmentDate: referral.expectedAppointmentDate || undefined,
      status: referral.status,
      issuedAt: referral.referralDate || undefined,
      sentAt: referral.referralDate || undefined,
      createdAt: referral.createdAt,
      updatedAt: referral.updatedAt,
      deletedAt: referral.deletedAt || undefined,
      canEdit,
      canIssue,
      canSend,
    };

    // Include AI generated content if present
    if (referral.additionalNotes && referral.metadata?.aiGenerated) {
      (response as any).generatedContent = referral.additionalNotes;
      (response as any).aiMetadata = referral.metadata?.aiMetadata || null;
    }

    return response;
  }

  /**
   * Map a SickNote entity to a SickNoteResponseDto.
   * Computes active/expired flags based on status and dates.
   *
   * @param sickNote - The sick note entity
   * @returns The sick note response DTO
   */
  private mapSickNoteToResponse(sickNote: SickNote): SickNoteResponseDto {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const isActive =
      sickNote.status === SickNoteStatus.ISSUED &&
      sickNote.endDate >= today;

    const isExpired =
      sickNote.status === SickNoteStatus.ISSUED &&
      sickNote.endDate < today;

    const response: SickNoteResponseDto = {
      id: sickNote.id,
      workspaceId: sickNote.workspaceId,
      patientId: sickNote.patientId,
      consultationId: sickNote.consultationId || undefined,
      noteId: sickNote.noteId || undefined,
      doctorId: sickNote.doctorId,
      diagnosis: sickNote.diagnosis,
      recommendations: sickNote.recommendations || undefined,
      startDate: sickNote.startDate,
      endDate: sickNote.endDate,
      issueDate: sickNote.issueDate,
      durationDays: sickNote.durationDays,
      isFitForLightDuties: sickNote.isFitForLightDuties,
      lightDutiesDescription: sickNote.lightDutiesDescription || undefined,
      employerName: sickNote.employerName || undefined,
      employerAddress: sickNote.employerAddress || undefined,
      certificateNumber: sickNote.certificateNumber || undefined,
      metadata: sickNote.metadata || undefined,
      status: sickNote.status,
      createdAt: sickNote.createdAt,
      updatedAt: sickNote.updatedAt,
      deletedAt: sickNote.deletedAt || undefined,
      isActive,
      isExpired,
    };

    // Include AI generated content if present
    if (sickNote.recommendations && sickNote.metadata?.aiGenerated) {
      (response as any).generatedContent = sickNote.recommendations;
      (response as any).aiMetadata = sickNote.metadata?.aiMetadata || null;
    }

    // Include extension information
    if (sickNote.metadata?.isExtension) {
      (response as any).isExtension = true;
      (response as any).extensionOf = sickNote.metadata.extensionOf;
    }

    return response;
  }

  // ==========================================================================
  // SECTION 15: PRIVATE HELPERS — Audit Logging
  // ==========================================================================

  /**
   * Log an audit event with consistent formatting.
   * Wraps the AuditLogService call with error handling so audit
   * failures never bubble up and break business operations.
   *
   * @param eventType - The audit event type
   * @param outcome - Success or failure
   * @param resourceType - The entity type
   * @param resourceId - The entity ID
   * @param userId - The acting user
   * @param workspaceId - The workspace
   * @param action - Human-readable action description
   * @param metadata - Additional metadata
   */
  private async logAuditEvent(
    eventType: AuditEventType,
    outcome: AuditOutcome,
    resourceType: string,
    resourceId: string,
    userId: string,
    workspaceId: string,
    action: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    try {
      await this.auditLogService.log(
        {
          userId,
          action,
          eventType,
          outcome,
          resourceType,
          resourceId,
          metadata,
        },
        workspaceId,
      );
    } catch (error) {
      // Audit logging failures should never break business operations
      this.logger.warn(
        `Failed to create audit log for ${resourceType}/${resourceId}: ${this.extractErrorMessage(error)}`,
      );
    }
  }

  /**
   * Fire-and-forget AI usage report to the portal for billing/credit tracking.
   */
  private reportLetterAiUsage(
    userId: string,
    workspaceId: string,
    operation: AiOperation,
    model: string,
    totalTokens: number,
    responseTimeMs: number,
    status: AiUsageStatus,
    errorMessage?: string,
  ): void {
    // Estimate input/output split (AI letters are output-heavy)
    const inputTokens = Math.round(totalTokens * 0.3);
    const outputTokens = totalTokens - inputTokens;

    this.aiUsageReportingService.reportUsage({
      userId,
      workspaceId,
      provider: AIProvider.OPENAI,
      model,
      operation,
      tokenUsage: { inputTokens, outputTokens, totalTokens },
      responseTimeMs,
      status,
      errorMessage,
    }).catch(err => {
      this.logger.warn(`Failed to report letter AI usage: ${err.message}`);
    });
  }

  // ==========================================================================
  // SECTION 16: PRIVATE HELPERS — Date & Calculation Utilities
  // ==========================================================================

  /**
   * Calculate duration in days between two dates (inclusive).
   *
   * @param startDate - The start date
   * @param endDate - The end date
   * @returns Number of days (inclusive, minimum 1)
   */
  private calculateDurationDays(startDate: Date, endDate: Date): number {
    const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
    const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(days, 1); // Minimum 1 day
  }

  /**
   * Calculate a patient's age from their date of birth.
   *
   * @param dateOfBirth - Date of birth string or Date object
   * @returns Age as a string (e.g., "34 years") or "Unknown"
   */
  private calculateAge(dateOfBirth: string | Date | null): string {
    if (!dateOfBirth) {
      return 'Unknown';
    }

    try {
      const dob = new Date(dateOfBirth);
      if (isNaN(dob.getTime())) {
        return 'Unknown';
      }

      const today = new Date();
      let age = today.getFullYear() - dob.getFullYear();
      const monthDiff = today.getMonth() - dob.getMonth();

      if (
        monthDiff < 0 ||
        (monthDiff === 0 && today.getDate() < dob.getDate())
      ) {
        age--;
      }

      if (age < 0) return 'Unknown';
      if (age === 0) {
        // Calculate months for infants
        const months =
          (today.getFullYear() - dob.getFullYear()) * 12 +
          today.getMonth() -
          dob.getMonth();
        return months <= 0 ? 'Newborn' : `${months} months`;
      }

      return `${age} years`;
    } catch {
      return 'Unknown';
    }
  }

  // ==========================================================================
  // SECTION 17: PRIVATE HELPERS — Enum Mapping
  // ==========================================================================

  /**
   * Map a string referral type to the ReferralType enum.
   * Falls back to 'specialist' if the string does not match any known type.
   *
   * @param type - The referral type string
   * @returns The mapped referral type enum value
   */
  private mapStringToReferralType(type: string): any {
    const typeMap: Record<string, string> = {
      specialist: 'specialist',
      diagnostic: 'diagnostic',
      therapy: 'therapy',
      surgical: 'surgical',
      other: 'other',
    };

    return typeMap[type?.toLowerCase()] || 'specialist';
  }

  /**
   * Map a string work restriction to the WorkRestrictionType enum.
   * Falls back to 'full_rest' if the string does not match any known type.
   *
   * @param restriction - The work restriction string
   * @returns The mapped work restriction enum value
   */
  private mapStringToWorkRestriction(restriction: string | undefined): any {
    if (!restriction) return 'full_rest';

    const restrictionMap: Record<string, string> = {
      full_rest: 'full_rest',
      light_duty: 'light_duty',
      modified_duty: 'modified_duty',
      no_restriction: 'no_restriction',
      hospitalization: 'hospitalization',
    };

    return restrictionMap[restriction?.toLowerCase()] || 'full_rest';
  }

  // ==========================================================================
  // SECTION 18: PRIVATE HELPERS — Transcript Utilities
  // ==========================================================================

  /**
   * Count the number of transcript sections in a merged transcript string.
   *
   * @param transcript - The merged transcript string
   * @returns Number of transcript sections
   */
  private countTranscriptSections(transcript: string): number {
    if (!transcript) return 0;
    return (transcript.match(/--- Consultation Transcript/g) || []).length;
  }

  // ==========================================================================
  // SECTION 19: PRIVATE HELPERS — Error Handling Utilities
  // ==========================================================================

  /**
   * Extract a human-readable error message from an unknown error.
   *
   * @param error - The error object
   * @returns Error message string
   */
  private extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return 'Unknown error';
  }

  /**
   * Extract the error stack trace from an unknown error.
   *
   * @param error - The error object
   * @returns Stack trace string or undefined
   */
  private extractErrorStack(error: unknown): string | undefined {
    if (error instanceof Error) {
      return error.stack;
    }
    return undefined;
  }
}
