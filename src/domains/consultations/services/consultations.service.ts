import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Consultation } from '../entities/consultation.entity';
import { Patient } from '../../patients/entities/patient.entity';
import { Appointment } from '../../appointments/entities/appointment.entity';
import { ConsultationRepository } from '../repositories/consultation.repository';
import { ConsultationCollaboratorRepository } from '../repositories/consultation-collaborator.repository';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { BillService } from '../../billing/services/bill.service';
import {
  AuditEventType,
  AuditOutcome,
  CollaborationRole,
  AppointmentStatus,
  ConsultationStatus,
} from '../../../common/enums';
import {
  CreateConsultationDto,
  UpdateConsultationDto,
  ConsultationQueryDto,
  ConsultationResponseDto,
  PaginatedResponseDto,
  UpdateJoiningSettingsDto,
} from '../dto';

/**
 * Service for managing consultations
 * Handles CRUD operations with HIPAA-compliant audit logging and multi-tenancy support
 *
 * Performance improvements:
 *  • verifyAccess: uses consultation.workspaceId (no patient JOIN)
 *  • remove / update / updateJoiningSettings: lightweight findOne for ownership
 *    checks — heavy findByIdWithRelations only for the final response DTO.
 *  • findOne: verifies access inline from the already-loaded entity instead of
 *    issuing a redundant 2nd query.
 *  • create: patient + appointment validation run in parallel.
 *  • All audit logs are fire-and-forget (void promise + .catch) — they no longer
 *    block the HTTP response.
 */
@Injectable()
export class ConsultationsService {
  constructor(
    private readonly consultationRepository: ConsultationRepository,
    private readonly collaboratorRepository: ConsultationCollaboratorRepository,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
    private readonly billService: BillService,
  ) {
    this.logger.setContext('ConsultationsService');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CREATE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a new consultation with transaction
   * Auto-adds doctor as NOTE_OWNER collaborator
   */
  async create(
    dto: CreateConsultationDto,
    userId: string,
    workspaceId: string,
  ): Promise<ConsultationResponseDto> {
    this.logger.log(
      `Creating consultation for patient: ${dto.patientId}, appointment: ${dto.appointmentId}, workspace: ${workspaceId}`,
    );

    // ── Validate patient + appointment in parallel ──
    const [patient, appointment] = await Promise.all([
      this.dataSource.getRepository(Patient).findOne({
        where: { id: dto.patientId, workspaceId },
      }),
      this.dataSource.getRepository(Appointment).findOne({
        where: { id: dto.appointmentId, workspaceId },
      }),
    ]);

    if (!patient) {
      this.logger.error(`Patient not found: ${dto.patientId}`);
      throw new NotFoundException(`Patient with ID ${dto.patientId} not found`);
    }

    if (!appointment) {
      this.logger.error(`Appointment not found: ${dto.appointmentId}`);
      throw new NotFoundException(
        `Appointment with ID ${dto.appointmentId} not found`,
      );
    }

    // Check appointment not already linked to consultation (unique constraint)
    const existingConsultation = await this.consultationRepository.findByAppointment(
      dto.appointmentId,
      workspaceId,
    );

    if (existingConsultation) {
      this.logger.error(`Appointment already has consultation: ${dto.appointmentId}`);
      throw new ConflictException(
        `Appointment with ID ${dto.appointmentId} already has a consultation`,
      );
    }

    // Create consultation with transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Create consultation — doctorId is the currently authenticated user
      // (the clinician who starts the consultation), NOT the DTO value which
      // historically carried the appointment-creator's ID by mistake.
      const consultation = this.consultationRepository.create({
        patientId: dto.patientId,
        appointmentId: dto.appointmentId,
        doctorId: userId,
        status: dto.status,
        workspaceId,
        isOpenForJoining: dto.isOpenForJoining || false,
        requiresJoinApproval: dto.requiresJoinApproval ?? true,
      });

      const savedConsultation = await queryRunner.manager.save(consultation);

      // Write consultationId back to the appointment so appointment.consultationId stays in sync
      await queryRunner.manager.update(Appointment, dto.appointmentId, {
        consultationId: savedConsultation.id,
      });

      // Auto-add doctor as NOTE_OWNER collaborator
      const doctorCollaborator = this.collaboratorRepository.create({
        consultationId: savedConsultation.id,
        userId,
        role: CollaborationRole.DOCTOR,
        isActive: true,
      });

      await queryRunner.manager.save(doctorCollaborator);

      // Add additional collaborators if provided
      if (dto.collaborators && dto.collaborators.length > 0) {
        const additionalCollaborators = dto.collaborators.map((collab) =>
          this.collaboratorRepository.create({
            consultationId: savedConsultation.id,
            userId: collab.userId,
            role: collab.role,
            isActive: true,
          }),
        );

        await queryRunner.manager.save(additionalCollaborators);
      }

      await queryRunner.commitTransaction();

      this.logger.log(
        `Consultation created successfully - ID: ${savedConsultation.id}, appointment: ${dto.appointmentId}`,
      );

      // Audit log — fire-and-forget (does NOT block the HTTP response)
      void this.auditLogService
        .log(
          {
            userId,
            action: 'CREATE_CONSULTATION',
            eventType: AuditEventType.CREATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'Consultation',
            resourceId: savedConsultation.id,
            patientId: dto.patientId,
            metadata: {
              appointmentId: dto.appointmentId,
              doctorId: dto.doctorId,
              status: dto.status,
            },
          },
          workspaceId,
        )
        .catch((e) =>
          this.logger.error(
            `Failed to create audit log for consultation creation - ID: ${savedConsultation.id}`,
            e instanceof Error ? e.stack : String(e),
          ),
        );

      // Create DRAFT bill — fire-and-forget (bill failure must not roll back consultation)
      void this.billService
        .createBill(
          {
            patientId: dto.patientId,
            appointmentId: dto.appointmentId,
          },
          userId,
          workspaceId,
        )
        .then(() =>
          this.logger.log(
            `DRAFT bill created for consultation ${savedConsultation.id}, appointment: ${dto.appointmentId}`,
          ),
        )
        .catch((e) =>
          this.logger.error(
            `Failed to create DRAFT bill for consultation ${savedConsultation.id}`,
            e instanceof Error ? e.stack : String(e),
          ),
        );

      // Fetch with relations for response (single heavy load — this is the response DTO)
      const consultationWithRelations =
        await this.consultationRepository.findByIdWithRelations(
          savedConsultation.id,
          workspaceId,
        );

      return ConsultationResponseDto.fromEntity(consultationWithRelations!, userId);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Failed to create consultation for appointment: ${dto.appointmentId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // READ
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Find all consultations with filters and pagination
   */
  async findAll(
    query: ConsultationQueryDto,
    workspaceId: string,
  ): Promise<PaginatedResponseDto<ConsultationResponseDto>> {
    this.logger.log(`Finding all consultations for workspace: ${workspaceId}`);

    const [consultations, total] =
      await this.consultationRepository.findWithFilters(query, workspaceId);

    return {
      data: consultations.map((consultation) =>
        ConsultationResponseDto.fromEntity(consultation),
      ),
      meta: {
        total,
        page: query.page || 1,
        limit: query.limit || 10,
        totalPages: Math.ceil(total / (query.limit || 10)),
      },
    };
  }

  /**
   * Find one consultation by ID.
   *
   * Performance: verifies access inline from the entity's collaborators
   * array (already loaded by findByIdWithRelations) instead of issuing
   * a redundant verifyAccess() call which would fire 1–2 extra queries.
   */
  async findOne(
    id: string,
    userId: string,
    workspaceId: string,
  ): Promise<ConsultationResponseDto> {
    this.logger.log(`Finding consultation by ID: ${id}, workspace: ${workspaceId}`);

    const consultation = await this.consultationRepository.findByIdWithRelations(
      id,
      workspaceId,
    );

    if (!consultation) {
      this.logger.error(`Consultation not found: ${id}`);
      throw new NotFoundException(`Consultation with ID ${id} not found`);
    }

    // Inline access check — entity already has collaborators loaded
    const isOwner = consultation.doctorId === userId;
    if (!isOwner) {
      const isCollaborator = consultation.collaborators?.some(
        (c) => c.userId === userId && c.isActive && !c.deletedAt,
      );
      if (!isCollaborator) {
        this.logger.error(
          `User ${userId} does not have access to consultation: ${id}`,
        );
        throw new ForbiddenException('You do not have access to this consultation');
      }
    }

    // Audit log — fire-and-forget
    void this.auditLogService
      .log(
        {
          userId,
          action: 'VIEW_CONSULTATION',
          eventType: AuditEventType.READ,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'Consultation',
          resourceId: id,
          patientId: consultation.patientId,
        },
        workspaceId,
      )
      .catch((e) =>
        this.logger.error(
          `Failed to create audit log for consultation view - ID: ${id}`,
          e instanceof Error ? e.stack : String(e),
        ),
      );

    return ConsultationResponseDto.fromEntity(consultation, userId);
  }

  /**
   * Find consultations by patient ID
   */
  async findByPatient(
    patientId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedResponseDto<ConsultationResponseDto>> {
    this.logger.log(
      `Finding consultations by patient: ${patientId}, workspace: ${workspaceId}`,
    );

    // Validate patient exists — lightweight, no relations
    const patientExists = await this.dataSource
      .getRepository(Patient)
      .count({ where: { id: patientId, workspaceId } });

    if (!patientExists) {
      this.logger.error(`Patient not found: ${patientId}`);
      throw new NotFoundException(`Patient with ID ${patientId} not found`);
    }

    const [consultations, total] =
      await this.consultationRepository.findByPatient(
        patientId,
        workspaceId,
        page,
        limit,
      );

    return {
      data: consultations.map((consultation) =>
        ConsultationResponseDto.fromEntity(consultation),
      ),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Find consultations by doctor ID
   */
  async findByDoctor(
    doctorId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedResponseDto<ConsultationResponseDto>> {
    this.logger.log(
      `Finding consultations by doctor: ${doctorId}, workspace: ${workspaceId}`,
    );

    const [consultations, total] =
      await this.consultationRepository.findByDoctor(
        doctorId,
        workspaceId,
        page,
        limit,
      );

    return {
      data: consultations.map((consultation) =>
        ConsultationResponseDto.fromEntity(consultation),
      ),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UPDATE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Update consultation.
   *
   * Performance: uses lightweight findOne (no JOINs) for ownership check,
   * then a single findByIdWithRelations for the response DTO.
   * Previous version fired findByIdWithRelations twice (14 JOINs total).
   */
  async update(
    id: string,
    dto: UpdateConsultationDto,
    userId: string,
    workspaceId: string,
  ): Promise<ConsultationResponseDto> {
    this.logger.log(`Updating consultation: ${id}, workspace: ${workspaceId}`);

    // Lightweight fetch — no JOINs
    const consultation = await this.consultationRepository.findOne({
      where: { id, workspaceId },
    });

    if (!consultation) {
      this.logger.error(`Consultation not found: ${id}`);
      throw new NotFoundException(`Consultation with ID ${id} not found`);
    }

    // Check if user is owner or WORKSPACE_OWNER collaborator
    const isOwner = consultation.doctorId === userId;
    if (!isOwner) {
      const collaborator = await this.consultationRepository.getUserCollaboratorInfo(
        id,
        userId,
        workspaceId,
      );
      if (!collaborator || collaborator.role !== CollaborationRole.WORKSPACE_OWNER) {
        this.logger.error(`User ${userId} not authorized to update consultation: ${id}`);
        throw new ForbiddenException(
          'Only consultation owner or workspace owner can update consultation',
        );
      }
    }

    // Store previous state for audit
    const previousState = {
      status: consultation.status,
      doctorId: consultation.doctorId,
    };

    // Update fields
    if (dto.status !== undefined) consultation.status = dto.status;
    if (dto.doctorId !== undefined) consultation.doctorId = dto.doctorId;
    if (dto.isOpenForJoining !== undefined)
      consultation.isOpenForJoining = dto.isOpenForJoining;
    if (dto.requiresJoinApproval !== undefined)
      consultation.requiresJoinApproval = dto.requiresJoinApproval;

    // ── Terminal-status transition: atomically sync linked appointment ──────
    // COMPLETED consultation → appointment COMPLETED
    // ARCHIVED  consultation → appointment CANCELLED  (archived = doctor-side cancel)
    const isTerminalTransition =
      dto.status !== undefined &&
      dto.status !== previousState.status &&
      (dto.status === ConsultationStatus.COMPLETED ||
        dto.status === ConsultationStatus.ARCHIVED);

    let updatedConsultation: Consultation;

    if (isTerminalTransition) {
      const appointmentStatus =
        dto.status === ConsultationStatus.COMPLETED
          ? AppointmentStatus.COMPLETED
          : AppointmentStatus.CANCELLED;

      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        updatedConsultation = await queryRunner.manager.save(consultation);

        if (consultation.appointmentId) {
          await queryRunner.manager.update(
            Appointment,
            consultation.appointmentId,
            { status: appointmentStatus, isActive: false },
          );
        }

        await queryRunner.commitTransaction();

        this.logger.log(
          `Consultation ${id} → ${dto.status}; appointment ${consultation.appointmentId} → ${appointmentStatus}`,
        );
      } catch (error) {
        await queryRunner.rollbackTransaction();
        this.logger.error(
          `Failed to update consultation ${id} with appointment sync`,
          error instanceof Error ? error.stack : String(error),
        );
        throw error;
      } finally {
        await queryRunner.release();
      }
    } else {
      // Non-terminal update — plain save is sufficient
      updatedConsultation = await this.consultationRepository.save(consultation);
    }

    this.logger.log(`Consultation updated successfully - ID: ${id}`);

    // Audit log — fire-and-forget
    void this.auditLogService
      .log(
        {
          userId,
          action: 'UPDATE_CONSULTATION',
          eventType: AuditEventType.UPDATE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'Consultation',
          resourceId: id,
          patientId: consultation.patientId,
          previousState,
          newState: {
            status: updatedConsultation.status,
            doctorId: updatedConsultation.doctorId,
          },
        },
        workspaceId,
      )
      .catch((e) =>
        this.logger.error(
          `Failed to create audit log for consultation update - ID: ${id}`,
          e instanceof Error ? e.stack : String(e),
        ),
      );

    // Single heavy load for the response DTO
    const consultationWithRelations =
      await this.consultationRepository.findByIdWithRelations(id, workspaceId);

    return ConsultationResponseDto.fromEntity(consultationWithRelations!, userId);
  }

  /**
   * Update consultation joining settings.
   *
   * Performance: lightweight findOne for ownership check.
   */
  async updateJoiningSettings(
    id: string,
    dto: UpdateJoiningSettingsDto,
    userId: string,
    workspaceId: string,
  ): Promise<ConsultationResponseDto> {
    this.logger.log(
      `Updating joining settings for consultation: ${id}, workspace: ${workspaceId}`,
    );

    // Lightweight fetch — no JOINs
    const consultation = await this.consultationRepository.findOne({
      where: { id, workspaceId },
    });

    if (!consultation) {
      this.logger.error(`Consultation not found: ${id}`);
      throw new NotFoundException(`Consultation with ID ${id} not found`);
    }

    // Check if user is owner or WORKSPACE_OWNER collaborator
    const isOwner = consultation.doctorId === userId;
    if (!isOwner) {
      const collaborator = await this.consultationRepository.getUserCollaboratorInfo(
        id,
        userId,
        workspaceId,
      );
      if (!collaborator || collaborator.role !== CollaborationRole.WORKSPACE_OWNER) {
        this.logger.error(
          `User ${userId} not authorized to update joining settings for consultation: ${id}`,
        );
        throw new ForbiddenException(
          'Only consultation owner or workspace owner can update joining settings',
        );
      }
    }

    // Update settings
    consultation.isOpenForJoining = dto.isOpenForJoining;
    consultation.requiresJoinApproval = dto.requiresJoinApproval;

    // Save updated consultation
    await this.consultationRepository.save(consultation);

    this.logger.log(`Consultation joining settings updated - ID: ${id}`);

    // Single heavy load for the response DTO
    const consultationWithRelations =
      await this.consultationRepository.findByIdWithRelations(id, workspaceId);

    return ConsultationResponseDto.fromEntity(consultationWithRelations!, userId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ACCESS CONTROL
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Verify user access to consultation.
   *
   * Performance: uses consultation.workspaceId directly (no patient JOIN).
   * The old version loaded the patient relation just to read patient.workspaceId.
   */
  async verifyAccess(
    consultationId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    // Lightweight: no relations loaded
    const consultation = await this.consultationRepository.findOne({
      where: { id: consultationId, workspaceId },
    });

    if (!consultation) {
      throw new NotFoundException(
        `Consultation with ID ${consultationId} not found`,
      );
    }

    // Check if user is owner
    if (consultation.doctorId === userId) {
      return;
    }

    // Check if user is active collaborator
    const isCollaborator = await this.consultationRepository.isUserCollaborator(
      consultationId,
      userId,
      workspaceId,
    );

    if (!isCollaborator) {
      this.logger.error(
        `User ${userId} does not have access to consultation: ${consultationId}`,
      );
      throw new ForbiddenException('You do not have access to this consultation');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DELETE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Remove (soft delete) consultation.
   *
   * Performance: lightweight findOne for ownership check — findByIdWithRelations
   * was loading 7 JOINs just to read doctorId + patientId.
   */
  async remove(id: string, userId: string, workspaceId: string): Promise<void> {
    this.logger.log(`Removing consultation: ${id}, workspace: ${workspaceId}`);

    // Lightweight fetch — no JOINs
    const consultation = await this.consultationRepository.findOne({
      where: { id, workspaceId },
    });

    if (!consultation) {
      this.logger.error(`Consultation not found: ${id}`);
      throw new NotFoundException(`Consultation with ID ${id} not found`);
    }

    // Only owner can delete
    if (consultation.doctorId !== userId) {
      this.logger.error(`User ${userId} not authorized to delete consultation: ${id}`);
      throw new ForbiddenException('Only consultation owner can delete consultation');
    }

    // Soft delete
    consultation.deletedAt = new Date();
    consultation.deletedBy = userId;
    consultation.isActive = false;

    await this.consultationRepository.save(consultation);

    this.logger.log(`Consultation removed successfully - ID: ${id}`);

    // Audit log — fire-and-forget
    void this.auditLogService
      .log(
        {
          userId,
          action: 'DELETE_CONSULTATION',
          eventType: AuditEventType.DELETE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'Consultation',
          resourceId: id,
          patientId: consultation.patientId,
        },
        workspaceId,
      )
      .catch((e) =>
        this.logger.error(
          `Failed to create audit log for consultation deletion - ID: ${id}`,
          e instanceof Error ? e.stack : String(e),
        ),
      );
  }
}
