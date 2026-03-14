/**
 * SickNoteService
 *
 * Full lifecycle management for medical sick notes / work-absence certificates.
 *
 * Status flow:
 *   DRAFT ──→ ISSUED ──→ EXPIRED   (auto when endDate passes, or manually)
 *    │                └──→ CANCELLED
 *    └──→ CANCELLED
 *
 * Key rules
 *   - doctorId is ALWAYS taken from the JWT (req.userId), never trusted from the body.
 *   - Only DRAFT notes may be updated.
 *   - Only ISSUED notes may be extended.
 *   - Extend creates a brand-new ISSUED note starting the day after the original's endDate.
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { IsNull } from 'typeorm';

import { SickNoteRepository }  from '../repositories/sick-note.repository';
import { PatientRepository }   from '../../patients/repositories/patient.repository';
import { LoggerService }       from '../../../common/logger/logger.service';
import { AuditLogService }     from '../../audit/services/audit-log.service';
import { AuditEventType, AuditOutcome, SickNoteStatus } from '../../../common/enums';
import { SickNote }            from '../entities/sick-note.entity';
import {
  CreateSickNoteDto,
  UpdateSickNoteDto,
  SickNoteQueryDto,
  SickNoteResponseDto,
  ExtendSickNoteDto,
  CancelSickNoteDto,
} from '../dto';
import { PaginatedResponseDto } from '../dto/paginated-response.dto';

@Injectable()
export class SickNoteService {
  constructor(
    private readonly sickNoteRepository: SickNoteRepository,
    private readonly patientRepository:  PatientRepository,
    private readonly logger:             LoggerService,
    private readonly auditLogService:    AuditLogService,
  ) {
    this.logger.setContext('SickNoteService');
  }

  // ── CREATE ─────────────────────────────────────────────────────────────────

  async create(
    dto: CreateSickNoteDto,
    userId: string,
    workspaceId: string,
  ): Promise<SickNoteResponseDto> {
    this.logger.log(`Creating sick note for patient: ${dto.patientId}, workspace: ${workspaceId}`);

    const patient = await this.patientRepository.findOne({
      where: { id: dto.patientId, workspaceId },
    });
    if (!patient) {
      throw new NotFoundException(`Patient ${dto.patientId} not found`);
    }

    const startDate = new Date(dto.startDate);
    const endDate   = new Date(dto.endDate);

    if (endDate <= startDate) {
      throw new BadRequestException('endDate must be after startDate');
    }

    const durationDays = this.calcDays(startDate, endDate);
    const issueDate    = dto.issueDate ? new Date(dto.issueDate) : new Date();

    const entity = this.sickNoteRepository.create({
      ...dto,
      doctorId:           userId,   // always from JWT
      workspaceId,
      issueDate,
      startDate,
      endDate,
      durationDays,
      isFitForLightDuties: dto.isFitForLightDuties ?? false,
      status:             SickNoteStatus.DRAFT,
    } as unknown as SickNote);

    try {
      const saved = await this.sickNoteRepository.save(entity as unknown as SickNote);
      this.logger.log(`Sick note created: ${saved.id}`);

      this.safeAudit({
        userId, workspaceId,
        action:       'CREATE_SICK_NOTE',
        eventType:    AuditEventType.CREATE,
        outcome:      AuditOutcome.SUCCESS,
        resourceId:   saved.id,
        patientId:    dto.patientId,
      });

      return SickNoteResponseDto.fromEntity(saved);
    } catch (err) {
      this.logger.error(
        `Failed to create sick note for patient: ${dto.patientId}`,
        err instanceof Error ? err.stack : String(err),
      );
      throw err;
    }
  }

  // ── READ ───────────────────────────────────────────────────────────────────

  async findAll(
    query: SickNoteQueryDto,
    workspaceId: string,
  ): Promise<PaginatedResponseDto<SickNoteResponseDto>> {
    this.logger.debug(`findAll sick notes, workspace: ${workspaceId}`);

    const [notes, total] = await this.sickNoteRepository.findWithFilters(query, workspaceId);
    const page  = query.page  ?? 1;
    const limit = query.limit ?? 20;

    return new PaginatedResponseDto(
      notes.map(n => SickNoteResponseDto.fromEntity(n)),
      total,
      page,
      limit,
    );
  }

  async findOne(id: string, workspaceId: string): Promise<SickNoteResponseDto> {
    const note = await this.sickNoteRepository.findOne({
      where: { id, workspaceId, deletedAt: IsNull() },
    });
    if (!note) throw new NotFoundException(`Sick note ${id} not found`);
    return SickNoteResponseDto.fromEntity(note);
  }

  async findByPatient(
    patientId: string,
    workspaceId: string,
    page  = 1,
    limit = 20,
  ): Promise<PaginatedResponseDto<SickNoteResponseDto>> {
    const [notes, total] = await this.sickNoteRepository.findByPatient(
      patientId, workspaceId, page, limit,
    );
    return new PaginatedResponseDto(
      notes.map(n => SickNoteResponseDto.fromEntity(n)),
      total, page, limit,
    );
  }

  async findActive(
    workspaceId: string,
    page  = 1,
    limit = 20,
  ): Promise<PaginatedResponseDto<SickNoteResponseDto>> {
    const [notes, total] = await this.sickNoteRepository.findActive(workspaceId, page, limit);
    return new PaginatedResponseDto(
      notes.map(n => SickNoteResponseDto.fromEntity(n)),
      total, page, limit,
    );
  }

  async findExpiring(
    workspaceId: string,
    days  = 7,
    page  = 1,
    limit = 20,
  ): Promise<PaginatedResponseDto<SickNoteResponseDto>> {
    const [notes, total] = await this.sickNoteRepository.findExpiring(days, workspaceId, page, limit);
    return new PaginatedResponseDto(
      notes.map(n => SickNoteResponseDto.fromEntity(n)),
      total, page, limit,
    );
  }

  // ── UPDATE ─────────────────────────────────────────────────────────────────

  async update(
    id: string,
    dto: UpdateSickNoteDto,
    userId: string,
    workspaceId: string,
  ): Promise<SickNoteResponseDto> {
    const note = await this.findEntityOrThrow(id, workspaceId);

    if (note.status !== SickNoteStatus.DRAFT) {
      throw new ConflictException(`Only DRAFT sick notes can be updated — current status: ${note.status}`);
    }

    const startDate = dto.startDate ? new Date(dto.startDate) : note.startDate;
    const endDate   = dto.endDate   ? new Date(dto.endDate)   : note.endDate;

    if (endDate <= startDate) {
      throw new BadRequestException('endDate must be after startDate');
    }

    const durationDays = this.calcDays(startDate, endDate);

    Object.assign(note, {
      ...dto,
      startDate,
      endDate,
      durationDays,
      issueDate: dto.issueDate ? new Date(dto.issueDate) : note.issueDate,
    });

    const saved = await this.sickNoteRepository.save(note as unknown as SickNote);

    this.safeAudit({
      userId, workspaceId,
      action:     'UPDATE_SICK_NOTE',
      eventType:  AuditEventType.UPDATE,
      outcome:    AuditOutcome.SUCCESS,
      resourceId: saved.id,
      patientId:  saved.patientId,
    });

    return SickNoteResponseDto.fromEntity(saved);
  }

  // ── BUSINESS OPERATIONS ────────────────────────────────────────────────────

  /**
   * Issue a sick note — DRAFT → ISSUED.
   * Auto-generates certificateNumber if not already set.
   */
  async issue(
    id: string,
    userId: string,
    workspaceId: string,
  ): Promise<SickNoteResponseDto> {
    const note = await this.findEntityOrThrow(id, workspaceId);

    if (note.status !== SickNoteStatus.DRAFT) {
      throw new ConflictException(
        `Sick note is ${note.status} — only DRAFT notes can be issued`,
      );
    }

    if (!note.certificateNumber) {
      const year  = new Date().getFullYear();
      const short = note.id.replace(/-/g, '').slice(0, 8).toUpperCase();
      note.certificateNumber = `SN-${year}-${short}`;
    }

    note.status    = SickNoteStatus.ISSUED;
    note.issueDate = new Date();

    const saved = await this.sickNoteRepository.save(note as unknown as SickNote);

    this.safeAudit({
      userId, workspaceId,
      action:     'ISSUE_SICK_NOTE',
      eventType:  AuditEventType.UPDATE,
      outcome:    AuditOutcome.SUCCESS,
      resourceId: saved.id,
      patientId:  saved.patientId,
      metadata:   { certificateNumber: saved.certificateNumber },
    });

    return SickNoteResponseDto.fromEntity(saved);
  }

  /** Cancel a DRAFT or ISSUED sick note. */
  async cancel(
    id: string,
    dto: CancelSickNoteDto,
    userId: string,
    workspaceId: string,
  ): Promise<SickNoteResponseDto> {
    const note = await this.findEntityOrThrow(id, workspaceId);

    if (note.status === SickNoteStatus.CANCELLED) {
      throw new ConflictException('Sick note is already cancelled');
    }
    if (note.status === SickNoteStatus.EXPIRED) {
      throw new ConflictException('Expired sick notes cannot be cancelled');
    }

    note.status   = SickNoteStatus.CANCELLED;
    note.metadata = {
      ...note.metadata,
      cancellationReason: dto.reason ?? null,
      cancelledBy:        userId,
      cancelledAt:        new Date().toISOString(),
    };

    const saved = await this.sickNoteRepository.save(note as unknown as SickNote);

    this.safeAudit({
      userId, workspaceId,
      action:    'CANCEL_SICK_NOTE',
      eventType: AuditEventType.UPDATE,
      outcome:   AuditOutcome.SUCCESS,
      resourceId: saved.id,
      patientId:  saved.patientId,
      metadata:  { reason: dto.reason },
    });

    return SickNoteResponseDto.fromEntity(saved);
  }

  /**
   * Extend a sick note — creates a NEW ISSUED sick note starting the day
   * after the original's endDate.  The original is NOT modified.
   */
  async extend(
    originalId: string,
    dto: ExtendSickNoteDto,
    userId: string,
    workspaceId: string,
  ): Promise<SickNoteResponseDto> {
    const original = await this.findEntityOrThrow(originalId, workspaceId);

    if (original.status !== SickNoteStatus.ISSUED) {
      throw new ConflictException(
        `Only ISSUED sick notes can be extended — current status: ${original.status}`,
      );
    }

    const newEndDate  = new Date(dto.newEndDate);
    const originalEnd = new Date(original.endDate);

    if (newEndDate <= originalEnd) {
      throw new BadRequestException('newEndDate must be after the original endDate');
    }

    const newStartDate = new Date(originalEnd);
    newStartDate.setDate(newStartDate.getDate() + 1);

    const durationDays = this.calcDays(newStartDate, newEndDate);

    const extension = this.sickNoteRepository.create({
      patientId:              original.patientId,
      doctorId:               userId,
      workspaceId,
      noteId:                 original.noteId,
      consultationId:         original.consultationId,
      diagnosis:              original.diagnosis,
      recommendations:        original.recommendations,
      employerName:           original.employerName,
      employerAddress:        original.employerAddress,
      isFitForLightDuties:    original.isFitForLightDuties,
      lightDutiesDescription: original.lightDutiesDescription,
      issueDate:              new Date(),
      startDate:              newStartDate,
      endDate:                newEndDate,
      durationDays,
      status:                 SickNoteStatus.ISSUED,
      metadata: {
        extendedFrom: originalId,
        extendedAt:   new Date().toISOString(),
      },
    } as unknown as SickNote);

    const saved = await this.sickNoteRepository.save(extension as unknown as SickNote);

    this.safeAudit({
      userId, workspaceId,
      action:    'EXTEND_SICK_NOTE',
      eventType: AuditEventType.CREATE,
      outcome:   AuditOutcome.SUCCESS,
      resourceId: saved.id,
      patientId:  saved.patientId,
      metadata:  { originalId, durationDays },
    });

    return SickNoteResponseDto.fromEntity(saved);
  }

  /** Manually expire an ISSUED sick note. */
  async expire(
    id: string,
    userId: string,
    workspaceId: string,
  ): Promise<SickNoteResponseDto> {
    const note = await this.findEntityOrThrow(id, workspaceId);

    if (note.status !== SickNoteStatus.ISSUED) {
      throw new ConflictException(
        `Sick note is ${note.status} — only ISSUED notes can be expired`,
      );
    }

    note.status = SickNoteStatus.EXPIRED;
    const saved = await this.sickNoteRepository.save(note as unknown as SickNote);

    this.safeAudit({
      userId, workspaceId,
      action:    'EXPIRE_SICK_NOTE',
      eventType: AuditEventType.UPDATE,
      outcome:   AuditOutcome.SUCCESS,
      resourceId: saved.id,
      patientId:  saved.patientId,
    });

    return SickNoteResponseDto.fromEntity(saved);
  }

  // ── SOFT DELETE / RESTORE ──────────────────────────────────────────────────

  async remove(id: string, userId: string, workspaceId: string): Promise<void> {
    const note = await this.findEntityOrThrow(id, workspaceId);

    (note as any).deletedAt  = new Date();
    note.deleted_by          = userId;

    await this.sickNoteRepository.save(note as unknown as SickNote);

    this.safeAudit({
      userId, workspaceId,
      action:    'DELETE_SICK_NOTE',
      eventType: AuditEventType.DELETE,
      outcome:   AuditOutcome.SUCCESS,
      resourceId: note.id,
      patientId:  note.patientId,
    });
  }

  async restore(id: string, userId: string, workspaceId: string): Promise<SickNoteResponseDto> {
    // Query without deletedAt: IsNull() to find soft-deleted records too
    const note = await this.sickNoteRepository.findOne({
      where: { id, workspaceId },
    });

    if (!note) throw new NotFoundException(`Sick note ${id} not found`);

    if (!(note as any).deletedAt) {
      throw new ConflictException('Sick note is not deleted');
    }

    (note as any).deletedAt  = null;
    note.deleted_by          = undefined;

    const saved = await this.sickNoteRepository.save(note as unknown as SickNote);

    this.safeAudit({
      userId, workspaceId,
      action:    'RESTORE_SICK_NOTE',
      eventType: AuditEventType.UPDATE,
      outcome:   AuditOutcome.SUCCESS,
      resourceId: saved.id,
      patientId:  saved.patientId,
    });

    return SickNoteResponseDto.fromEntity(saved);
  }

  // ── PRIVATE HELPERS ────────────────────────────────────────────────────────

  private async findEntityOrThrow(id: string, workspaceId: string): Promise<SickNote> {
    const note = await this.sickNoteRepository.findOne({
      where: { id, workspaceId, deletedAt: IsNull() },
    });
    if (!note) throw new NotFoundException(`Sick note ${id} not found`);
    return note;
  }

  /** Calendar-day difference rounded up. */
  private calcDays(start: Date, end: Date): number {
    return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  }

  private safeAudit(params: {
    userId: string;
    workspaceId: string;
    action: string;
    eventType: AuditEventType;
    outcome: AuditOutcome;
    resourceId: string;
    patientId: string;
    metadata?: Record<string, any>;
  }): void {
    const { workspaceId, ...rest } = params;
    this.auditLogService
      .log({ ...rest, resourceType: 'SickNote' }, workspaceId)
      .catch(err =>
        this.logger.error(
          `Audit log failed for sick note ${params.resourceId}`,
          err instanceof Error ? err.stack : String(err),
        ),
      );
  }
}
