import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { DataSource , IsNull } from 'typeorm';
import { add } from 'date-fns';
import { RepeatPrescription } from '../entities/repeat-prescription.entity';
import { Prescription } from '../entities/prescription.entity';
import { Appointment } from '../../appointments/entities/appointment.entity';
import { Consultation } from '../../consultations/entities/consultation.entity';
import { RepeatPrescriptionRepository } from '../repositories/repeat-prescription.repository';
import { PrescriptionRepository } from '../repositories/prescription.repository';
import { PatientRepository } from '../../patients/repositories/patient.repository';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { AuditEventType, AuditOutcome, PrescriptionStatus } from '../../../common/enums';
import {
  CreateRepeatPrescriptionDto,
  UpdateRepeatPrescriptionDto,
  IssueRepeatPrescriptionDto,
  CancelRepeatPrescriptionDto,
  RepeatPrescriptionQueryDto,
  RepeatPrescriptionResponseDto,
} from '../dto/repeat-prescription';
import { PrescriptionResponseDto } from '../dto/prescription';
import { PaginatedMetaResponseDto as PaginatedResponseDto } from '../dto/common/paginated-response.dto';

/**
 * Service for managing repeat prescriptions
 * Handles full lifecycle of repeat prescriptions including issuing refills
 */
@Injectable()
export class RepeatPrescriptionsService {
  constructor(
    private readonly repeatPrescriptionRepository: RepeatPrescriptionRepository,
    private readonly prescriptionRepository: PrescriptionRepository,
    private readonly patientRepository: PatientRepository,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext('RepeatPrescriptionsService');
  }

  /**
   * Create a new repeat prescription with audit logging
   */
  async create(
    dto: CreateRepeatPrescriptionDto,
    userId: string,
    workspaceId: string,
  ): Promise<RepeatPrescriptionResponseDto> {
    this.logger.log(
      `Creating repeat prescription for patient: ${dto.patientId}, workspace: ${workspaceId}`,
    );

    // Validate patient exists in workspace
    const patient = await this.patientRepository.findOne({
      where: { id: dto.patientId, workspaceId },
    });

    if (!patient) {
      this.logger.error(`Patient not found: ${dto.patientId}`);
      throw new NotFoundException(`Patient with ID ${dto.patientId} not found`);
    }

    // Validate dates
    if (dto.endDate && dto.startDate > dto.endDate) {
      this.logger.error('Start date must be before end date');
      throw new BadRequestException('Start date must be before end date');
    }

    if (dto.reviewDate && dto.reviewDate < dto.startDate) {
      this.logger.error('Review date must be after start date');
      throw new BadRequestException('Review date must be after start date');
    }

    // Calculate next due date if repeat interval is provided
    let nextDueDate: Date | undefined;
    if (dto.repeatInterval && dto.repeatIntervalUnit) {
      nextDueDate = this.calculateNextDueDate(
        dto.startDate,
        dto.repeatInterval,
        dto.repeatIntervalUnit,
      );
    }

    // Create repeat prescription entity — doctorId always comes from the JWT token (req.userId),
    // never trusted from the request body.
    const repeatPrescription = this.repeatPrescriptionRepository.create({
      ...dto,
      doctorId: userId,
      status: PrescriptionStatus.ACTIVE,
      repeatsIssued: 0,
      nextDueDate,
    });

    try {
      // Save repeat prescription to database
      const savedRepeatPrescription = await this.repeatPrescriptionRepository.save(
        repeatPrescription,
      );

      this.logger.log(
        `Repeat prescription created successfully - ID: ${savedRepeatPrescription.id}, patient: ${dto.patientId}`,
      );

      // Audit log for CREATE_REPEAT_PRESCRIPTION (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'CREATE_REPEAT_PRESCRIPTION',
            eventType: AuditEventType.CREATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'RepeatPrescription',
            resourceId: savedRepeatPrescription.id,
            patientId: dto.patientId,
            metadata: {
              medicine: dto.medicine,
              maxRepeats: dto.maxRepeats,
              repeatInterval: dto.repeatInterval,
              repeatIntervalUnit: dto.repeatIntervalUnit,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for repeat prescription creation - ID: ${savedRepeatPrescription.id}`,
          auditError instanceof Error ? auditError.stack : String(auditError),
        );
      }

      return RepeatPrescriptionResponseDto.fromEntity(savedRepeatPrescription);
    } catch (error) {
      this.logger.error(
        `Failed to create repeat prescription for patient: ${dto.patientId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find all repeat prescriptions with filters and pagination
   */
  async findAll(
    query: RepeatPrescriptionQueryDto,
    workspaceId: string,
  ): Promise<PaginatedResponseDto<RepeatPrescriptionResponseDto>> {
    this.logger.log(`Finding all repeat prescriptions for workspace: ${workspaceId}`);

    try {
      const [repeatPrescriptions, total] =
        await this.repeatPrescriptionRepository.findWithFilters(query, workspaceId);

      return {
        data: repeatPrescriptions.map((rp) =>
          RepeatPrescriptionResponseDto.fromEntity(rp),
        ),
        meta: {
          total,
          page: query.page || 1,
          limit: query.limit || 10,
          totalPages: Math.ceil(total / (query.limit || 10)),
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to find repeat prescriptions for workspace: ${workspaceId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find repeat prescriptions by patient ID with pagination
   */
  async findByPatient(
    patientId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedResponseDto<RepeatPrescriptionResponseDto>> {
    this.logger.log(
      `Finding repeat prescriptions by patient: ${patientId}, workspace: ${workspaceId}`,
    );

    try {
      // Validate patient exists
      const patient = await this.patientRepository.findOne({
        where: { id: patientId, workspaceId },
      });

      if (!patient) {
        this.logger.error(`Patient not found: ${patientId}`);
        throw new NotFoundException(`Patient with ID ${patientId} not found`);
      }

      const [repeatPrescriptions, total] =
        await this.repeatPrescriptionRepository.findByPatient(
          patientId,
          workspaceId,
          page,
          Math.min(limit, 100),
        );

      return {
        data: repeatPrescriptions.map((rp) =>
          RepeatPrescriptionResponseDto.fromEntity(rp),
        ),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to find repeat prescriptions by patient: ${patientId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find repeat prescriptions due for refill
   */
  async findDueForRefill(
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedResponseDto<RepeatPrescriptionResponseDto>> {
    this.logger.log(
      `Finding repeat prescriptions due for refill, workspace: ${workspaceId}`,
    );

    try {
      const [repeatPrescriptions, total] =
        await this.repeatPrescriptionRepository.findDueForRefill(
          workspaceId,
          page,
          Math.min(limit, 100),
        );

      return {
        data: repeatPrescriptions.map((rp) =>
          RepeatPrescriptionResponseDto.fromEntity(rp),
        ),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to find repeat prescriptions due for refill`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find repeat prescriptions requiring review
   */
  async findRequiringReview(
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedResponseDto<RepeatPrescriptionResponseDto>> {
    this.logger.log(
      `Finding repeat prescriptions requiring review, workspace: ${workspaceId}`,
    );

    try {
      const [repeatPrescriptions, total] =
        await this.repeatPrescriptionRepository.findRequiringReview(
          workspaceId,
          page,
          Math.min(limit, 100),
        );

      return {
        data: repeatPrescriptions.map((rp) =>
          RepeatPrescriptionResponseDto.fromEntity(rp),
        ),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to find repeat prescriptions requiring review`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find repeat prescriptions expiring within specified days
   */
  async findExpiring(
    workspaceId: string,
    days: number,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedResponseDto<RepeatPrescriptionResponseDto>> {
    this.logger.log(
      `Finding repeat prescriptions expiring within ${days} days, workspace: ${workspaceId}`,
    );

    if (days < 1) {
      throw new BadRequestException('Days must be a positive integer');
    }

    try {
      const [repeatPrescriptions, total] =
        await this.repeatPrescriptionRepository.findExpiring(
          workspaceId,
          days,
          page,
          Math.min(limit, 100),
        );

      return {
        data: repeatPrescriptions.map((rp) =>
          RepeatPrescriptionResponseDto.fromEntity(rp),
        ),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to find repeat prescriptions expiring within ${days} days`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find single repeat prescription by ID
   */
  async findOne(
    id: string,
    workspaceId: string,
  ): Promise<RepeatPrescriptionResponseDto> {
    this.logger.log(
      `Finding repeat prescription by ID: ${id}, workspace: ${workspaceId}`,
    );

    try {
      const repeatPrescription =
        await this.repeatPrescriptionRepository.findOneByIdAndWorkspace(
          id,
          workspaceId,
        );

      if (!repeatPrescription) {
        this.logger.error(`Repeat prescription not found: ${id}`);
        throw new NotFoundException(`Repeat prescription with ID ${id} not found`);
      }

      return RepeatPrescriptionResponseDto.fromEntity(repeatPrescription);
    } catch (error) {
      this.logger.error(
        `Failed to find repeat prescription by ID: ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Update a repeat prescription entry
   */
  async update(
    id: string,
    dto: UpdateRepeatPrescriptionDto,
    userId: string,
    workspaceId: string,
  ): Promise<RepeatPrescriptionResponseDto> {
    this.logger.log(
      `Updating repeat prescription: ${id}, workspace: ${workspaceId}`,
    );

    try {
      const repeatPrescription =
        await this.repeatPrescriptionRepository.findOneByIdAndWorkspace(
          id,
          workspaceId,
        );

      if (!repeatPrescription) {
        this.logger.error(`Repeat prescription not found: ${id}`);
        throw new NotFoundException(`Repeat prescription with ID ${id} not found`);
      }

      // Validate dates if being updated
      if (dto.startDate && dto.endDate && dto.startDate > dto.endDate) {
        this.logger.error('Start date must be before end date');
        throw new BadRequestException('Start date must be before end date');
      }

      if (dto.reviewDate && dto.startDate && dto.reviewDate < dto.startDate) {
        this.logger.error('Review date must be after start date');
        throw new BadRequestException('Review date must be after start date');
      }

      // Update fields
      Object.assign(repeatPrescription, dto);

      // Recalculate next due date if repeat interval changed
      if (
        (dto.repeatInterval !== undefined || dto.repeatIntervalUnit !== undefined) &&
        repeatPrescription.lastIssuedDate
      ) {
        repeatPrescription.nextDueDate = this.calculateNextDueDate(
          repeatPrescription.lastIssuedDate,
          repeatPrescription.repeatInterval!,
          repeatPrescription.repeatIntervalUnit!,
        );
      }

      const updatedRepeatPrescription =
        await this.repeatPrescriptionRepository.save(repeatPrescription);

      this.logger.log(`Repeat prescription updated successfully - ID: ${id}`);

      // Audit log for UPDATE_REPEAT_PRESCRIPTION (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'UPDATE_REPEAT_PRESCRIPTION',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'RepeatPrescription',
            resourceId: id,
            patientId: repeatPrescription.patientId,
            metadata: {
              updates: Object.keys(dto),
              medicine: updatedRepeatPrescription.medicine,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for repeat prescription update - ID: ${id}`,
          auditError instanceof Error ? auditError.stack : String(auditError),
        );
      }

      return RepeatPrescriptionResponseDto.fromEntity(updatedRepeatPrescription);
    } catch (error) {
      this.logger.error(
        `Failed to update repeat prescription: ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Issue a repeat prescription refill
   * CRITICAL BUSINESS LOGIC: Validates all constraints before issuing
   */
  async issueRepeat(
    id: string,
    dto: IssueRepeatPrescriptionDto,
    userId: string,
    workspaceId: string,
  ): Promise<{
    prescription: PrescriptionResponseDto;
    repeatPrescription: RepeatPrescriptionResponseDto;
  }> {
    this.logger.log(
      `Issuing repeat prescription refill: ${id}, workspace: ${workspaceId}`,
    );

    try {
      const repeatPrescription =
        await this.repeatPrescriptionRepository.findOneByIdAndWorkspace(
          id,
          workspaceId,
        );

      if (!repeatPrescription) {
        this.logger.error(`Repeat prescription not found: ${id}`);
        throw new NotFoundException(`Repeat prescription with ID ${id} not found`);
      }

      // Validation 1: Check status is ACTIVE
      if (repeatPrescription.status !== PrescriptionStatus.ACTIVE) {
        this.logger.error(
          `Repeat prescription is not active - Status: ${repeatPrescription.status}`,
        );
        throw new ConflictException(
          `Cannot issue repeat: prescription status is ${repeatPrescription.status}`,
        );
      }

      // Validation 2: Check repeatsIssued < maxRepeats (if maxRepeats is set)
      if (
        repeatPrescription.maxRepeats &&
        repeatPrescription.repeatsIssued >= repeatPrescription.maxRepeats
      ) {
        this.logger.error(
          `Maximum repeats reached: ${repeatPrescription.repeatsIssued}/${repeatPrescription.maxRepeats}`,
        );
        throw new ConflictException(
          `Maximum repeats reached (${repeatPrescription.maxRepeats})`,
        );
      }

      // Validation 3: Check not past endDate (if endDate is set)
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (repeatPrescription.endDate) {
        const endDate = new Date(repeatPrescription.endDate);
        endDate.setHours(0, 0, 0, 0);

        if (today > endDate) {
          this.logger.error(
            `Repeat prescription has expired - End date: ${repeatPrescription.endDate}`,
          );
          throw new ConflictException(
            'Cannot issue repeat: prescription has expired',
          );
        }
      }

      // Validation 4: Check requiresReview
      if (repeatPrescription.requiresReview && repeatPrescription.reviewDate) {
        const reviewDate = new Date(repeatPrescription.reviewDate);
        reviewDate.setHours(0, 0, 0, 0);

        if (today >= reviewDate) {
          this.logger.error(
            `Repeat prescription requires review - Review date: ${repeatPrescription.reviewDate}`,
          );
          throw new ConflictException(
            'Cannot issue repeat: prescription requires review',
          );
        }
      }

      // Validate appointment exists in workspace
      const appointmentRepo = this.dataSource.getRepository(Appointment);
      const appointment = await appointmentRepo.findOne({
        where: { id: dto.appointmentId, workspaceId },
      });

      if (!appointment) {
        this.logger.error(`Appointment not found: ${dto.appointmentId}`);
        throw new NotFoundException(
          `Appointment with ID ${dto.appointmentId} not found`,
        );
      }

      // Validate consultation exists and belongs to the appointment
      const consultationRepo = this.dataSource.getRepository(Consultation);
      const consultation = await consultationRepo.findOne({
        where: { id: dto.consultationId, appointmentId: dto.appointmentId },
      });

      if (!consultation) {
        this.logger.error(`Consultation not found: ${dto.consultationId}`);
        throw new NotFoundException(
          `Consultation with ID ${dto.consultationId} not found`,
        );
      }

      // Create new prescription from repeat prescription
      const prescription = this.prescriptionRepository.create({
        medicine: repeatPrescription.medicine,
        dose: repeatPrescription.dose,
        route: repeatPrescription.route,
        frequency: repeatPrescription.frequency,
        days: repeatPrescription.daysSupply?.toString(),
        appointmentId: dto.appointmentId,
        consultationId: dto.consultationId,
        doctorId: repeatPrescription.doctorId,
        noteId: dto.noteId,
      });

      // Save prescription
      const savedPrescription = await this.prescriptionRepository.save(prescription);

      // Update repeat prescription
      repeatPrescription.repeatsIssued += 1;
      repeatPrescription.lastIssuedDate = today;

      // Calculate next due date
      if (
        repeatPrescription.repeatInterval &&
        repeatPrescription.repeatIntervalUnit
      ) {
        repeatPrescription.nextDueDate = this.calculateNextDueDate(
          today,
          repeatPrescription.repeatInterval,
          repeatPrescription.repeatIntervalUnit,
        );
      }

      // If max repeats reached, set status to COMPLETED
      if (
        repeatPrescription.maxRepeats &&
        repeatPrescription.repeatsIssued >= repeatPrescription.maxRepeats
      ) {
        repeatPrescription.status = PrescriptionStatus.COMPLETED;
        this.logger.log(
          `Repeat prescription completed - Max repeats reached: ${repeatPrescription.maxRepeats}`,
        );
      }

      const updatedRepeatPrescription =
        await this.repeatPrescriptionRepository.save(repeatPrescription);

      this.logger.log(
        `Repeat prescription issued successfully - ID: ${id}, New prescription: ${savedPrescription.id}`,
      );

      // Audit log for CREATE_PRESCRIPTION (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'CREATE_PRESCRIPTION',
            eventType: AuditEventType.CREATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'Prescription',
            resourceId: savedPrescription.id,
            patientId: repeatPrescription.patientId,
            metadata: {
              appointmentId: dto.appointmentId,
              consultationId: dto.consultationId,
              medicine: savedPrescription.medicine,
              isRepeatIssue: true,
              repeatPrescriptionId: id,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for prescription creation - ID: ${savedPrescription.id}`,
          auditError instanceof Error ? auditError.stack : String(auditError),
        );
      }

      // Audit log for ISSUE_REPEAT_PRESCRIPTION (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'ISSUE_REPEAT_PRESCRIPTION',
            eventType: AuditEventType.CREATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'RepeatPrescription',
            resourceId: id,
            patientId: repeatPrescription.patientId,
            metadata: {
              prescriptionId: savedPrescription.id,
              repeatsIssued: updatedRepeatPrescription.repeatsIssued,
              maxRepeats: updatedRepeatPrescription.maxRepeats,
              status: updatedRepeatPrescription.status,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for repeat prescription issue - ID: ${id}`,
          auditError instanceof Error ? auditError.stack : String(auditError),
        );
      }

      return {
        prescription: PrescriptionResponseDto.fromEntity(savedPrescription),
        repeatPrescription:
          RepeatPrescriptionResponseDto.fromEntity(updatedRepeatPrescription),
      };
    } catch (error) {
      this.logger.error(
        `Failed to issue repeat prescription: ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Cancel a repeat prescription
   */
  async cancelRepeatPrescription(
    id: string,
    dto: CancelRepeatPrescriptionDto,
    userId: string,
    workspaceId: string,
  ): Promise<RepeatPrescriptionResponseDto> {
    this.logger.log(
      `Cancelling repeat prescription: ${id}, workspace: ${workspaceId}`,
    );

    try {
      const repeatPrescription =
        await this.repeatPrescriptionRepository.findOneByIdAndWorkspace(
          id,
          workspaceId,
        );

      if (!repeatPrescription) {
        this.logger.error(`Repeat prescription not found: ${id}`);
        throw new NotFoundException(`Repeat prescription with ID ${id} not found`);
      }

      // Update status and cancellation details
      repeatPrescription.status = PrescriptionStatus.CANCELLED;
      repeatPrescription.cancellationReason = dto.cancellationReason;
      repeatPrescription.cancelledBy = userId;
      repeatPrescription.cancelledDate = new Date();

      const updatedRepeatPrescription =
        await this.repeatPrescriptionRepository.save(repeatPrescription);

      this.logger.log(`Repeat prescription cancelled successfully - ID: ${id}`);

      // Audit log for CANCEL_REPEAT_PRESCRIPTION (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'CANCEL_REPEAT_PRESCRIPTION',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'RepeatPrescription',
            resourceId: id,
            patientId: repeatPrescription.patientId,
            metadata: {
              cancellationReason: dto.cancellationReason,
              medicine: updatedRepeatPrescription.medicine,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for repeat prescription cancellation - ID: ${id}`,
          auditError instanceof Error ? auditError.stack : String(auditError),
        );
      }

      return RepeatPrescriptionResponseDto.fromEntity(updatedRepeatPrescription);
    } catch (error) {
      this.logger.error(
        `Failed to cancel repeat prescription: ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Put repeat prescription on hold
   */
  async putOnHold(
    id: string,
    userId: string,
    workspaceId: string,
  ): Promise<RepeatPrescriptionResponseDto> {
    this.logger.log(
      `Putting repeat prescription on hold: ${id}, workspace: ${workspaceId}`,
    );

    try {
      const repeatPrescription =
        await this.repeatPrescriptionRepository.findOneByIdAndWorkspace(
          id,
          workspaceId,
        );

      if (!repeatPrescription) {
        this.logger.error(`Repeat prescription not found: ${id}`);
        throw new NotFoundException(`Repeat prescription with ID ${id} not found`);
      }

      if (repeatPrescription.status !== PrescriptionStatus.ACTIVE) {
        this.logger.error(
          `Repeat prescription is not active - Status: ${repeatPrescription.status}`,
        );
        throw new ConflictException(
          `Cannot put on hold: prescription status is ${repeatPrescription.status}`,
        );
      }

      repeatPrescription.status = PrescriptionStatus.ON_HOLD;

      const updatedRepeatPrescription =
        await this.repeatPrescriptionRepository.save(repeatPrescription);

      this.logger.log(`Repeat prescription put on hold successfully - ID: ${id}`);

      // Audit log (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'UPDATE_REPEAT_PRESCRIPTION',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'RepeatPrescription',
            resourceId: id,
            patientId: repeatPrescription.patientId,
            metadata: {
              action: 'PUT_ON_HOLD',
              medicine: updatedRepeatPrescription.medicine,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for repeat prescription on hold - ID: ${id}`,
          auditError instanceof Error ? auditError.stack : String(auditError),
        );
      }

      return RepeatPrescriptionResponseDto.fromEntity(updatedRepeatPrescription);
    } catch (error) {
      this.logger.error(
        `Failed to put repeat prescription on hold: ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Reactivate a repeat prescription
   */
  async reactivate(
    id: string,
    userId: string,
    workspaceId: string,
  ): Promise<RepeatPrescriptionResponseDto> {
    this.logger.log(
      `Reactivating repeat prescription: ${id}, workspace: ${workspaceId}`,
    );

    try {
      const repeatPrescription =
        await this.repeatPrescriptionRepository.findOneByIdAndWorkspace(
          id,
          workspaceId,
        );

      if (!repeatPrescription) {
        this.logger.error(`Repeat prescription not found: ${id}`);
        throw new NotFoundException(`Repeat prescription with ID ${id} not found`);
      }

      if (repeatPrescription.status !== PrescriptionStatus.ON_HOLD) {
        this.logger.error(
          `Repeat prescription is not on hold - Status: ${repeatPrescription.status}`,
        );
        throw new ConflictException(
          `Cannot reactivate: prescription status is ${repeatPrescription.status}`,
        );
      }

      repeatPrescription.status = PrescriptionStatus.ACTIVE;

      const updatedRepeatPrescription =
        await this.repeatPrescriptionRepository.save(repeatPrescription);

      this.logger.log(`Repeat prescription reactivated successfully - ID: ${id}`);

      // Audit log (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'UPDATE_REPEAT_PRESCRIPTION',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'RepeatPrescription',
            resourceId: id,
            patientId: repeatPrescription.patientId,
            metadata: {
              action: 'REACTIVATE',
              medicine: updatedRepeatPrescription.medicine,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for repeat prescription reactivation - ID: ${id}`,
          auditError instanceof Error ? auditError.stack : String(auditError),
        );
      }

      return RepeatPrescriptionResponseDto.fromEntity(updatedRepeatPrescription);
    } catch (error) {
      this.logger.error(
        `Failed to reactivate repeat prescription: ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Soft delete a repeat prescription entry
   */
  async remove(
    id: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    this.logger.log(
      `Deleting repeat prescription: ${id}, workspace: ${workspaceId}`,
    );

    try {
      const repeatPrescription =
        await this.repeatPrescriptionRepository.findOneByIdAndWorkspace(
          id,
          workspaceId,
        );

      if (!repeatPrescription) {
        this.logger.error(`Repeat prescription not found: ${id}`);
        throw new NotFoundException(`Repeat prescription with ID ${id} not found`);
      }

      // Soft delete
      repeatPrescription.deletedAt = new Date();
      await this.repeatPrescriptionRepository.save(repeatPrescription);

      this.logger.log(`Repeat prescription deleted successfully - ID: ${id}`);

      // Audit log for DELETE_REPEAT_PRESCRIPTION (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'DELETE_REPEAT_PRESCRIPTION',
            eventType: AuditEventType.DELETE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'RepeatPrescription',
            resourceId: id,
            patientId: repeatPrescription.patientId,
            metadata: {
              medicine: repeatPrescription.medicine,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for repeat prescription deletion - ID: ${id}`,
          auditError instanceof Error ? auditError.stack : String(auditError),
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to delete repeat prescription: ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Bulk create multiple repeat prescriptions in a single transaction.
   *
   * All prescriptions are created atomically — if any fails, the entire batch
   * is rolled back. Validates patients exist before creation.
   *
   * @param dtos - Array of create DTOs
   * @param userId - Authenticated user ID
   * @param workspaceId - Tenant workspace ID
   * @returns Array of created repeat prescription responses
   */
  async bulkCreate(
    dtos: CreateRepeatPrescriptionDto[],
    userId: string,
    workspaceId: string,
  ): Promise<RepeatPrescriptionResponseDto[]> {
    this.logger.log(
      `Bulk creating ${dtos.length} repeat prescriptions, workspace: ${workspaceId}`,
    );

    if (!dtos || dtos.length === 0) {
      throw new BadRequestException('At least one prescription is required');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const results: RepeatPrescriptionResponseDto[] = [];

      for (const dto of dtos) {
        // Validate patient exists
        const patient = await this.patientRepository.findOne({
          where: { id: dto.patientId, workspaceId },
        });

        if (!patient) {
          throw new NotFoundException(
            `Patient with ID ${dto.patientId} not found`,
          );
        }

        // Validate dates
        if (dto.endDate && dto.startDate > dto.endDate) {
          throw new BadRequestException(
            `Start date must be before end date for ${dto.medicine}`,
          );
        }

        // doctorId always comes from the JWT token (req.userId), never from the request body.
        const repeatPrescription = queryRunner.manager.create(
          RepeatPrescription,
          {
            ...dto,
            doctorId: userId,
            workspaceId,
            prescribedBy: userId,
            status: PrescriptionStatus.ACTIVE,
          },
        );

        // Calculate next due date if interval provided
        if (dto.repeatInterval) {
          repeatPrescription.nextDueDate = this.calculateNextDueDate(
            dto.startDate || new Date(),
            dto.repeatInterval,
            dto.repeatIntervalUnit || 'days',
          );
        }

        const saved = await queryRunner.manager.save(
          RepeatPrescription,
          repeatPrescription,
        );
        results.push(RepeatPrescriptionResponseDto.fromEntity(saved));
      }

      await queryRunner.commitTransaction();

      this.logger.log(
        `Bulk created ${results.length} repeat prescriptions successfully`,
      );

      // Audit log (outside transaction)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'BULK_CREATE_REPEAT_PRESCRIPTIONS',
            eventType: AuditEventType.CREATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'RepeatPrescription',
            metadata: {
              count: results.length,
              ids: results.map((r) => r.id),
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.warn(
          `Failed to create audit log for bulk create: ${auditError instanceof Error ? auditError.message : String(auditError)}`,
        );
      }

      return results;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Failed to bulk create repeat prescriptions: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Restore a soft-deleted repeat prescription.
   *
   * @param id - Repeat prescription ID
   * @param userId - Authenticated user ID
   * @param workspaceId - Tenant workspace ID
   * @returns Restored repeat prescription response
   */
  async restore(
    id: string,
    userId: string,
    workspaceId: string,
  ): Promise<RepeatPrescriptionResponseDto> {
    this.logger.log(`Restoring repeat prescription: ${id}`);

    try {
      // Find including soft-deleted records
      const repeatPrescription = await this.repeatPrescriptionRepository.findOne(
        {
          where: { id, workspaceId },
          withDeleted: true,
        },
      );

      if (!repeatPrescription) {
        throw new NotFoundException(
          `Repeat prescription with ID ${id} not found`,
        );
      }

      if (!repeatPrescription.deletedAt) {
        throw new ConflictException(
          'Repeat prescription is not deleted and does not need restoration',
        );
      }

      repeatPrescription.deletedAt = undefined;
      const restored = await this.repeatPrescriptionRepository.save(
        repeatPrescription,
      );

      this.logger.log(`Repeat prescription restored: ${id}`);

      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'RESTORE_REPEAT_PRESCRIPTION',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'RepeatPrescription',
            resourceId: id,
            patientId: repeatPrescription.patientId,
            metadata: { medicine: repeatPrescription.medicine },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.warn(
          `Failed to create audit log for restore: ${auditError instanceof Error ? auditError.message : String(auditError)}`,
        );
      }

      return RepeatPrescriptionResponseDto.fromEntity(restored);
    } catch (error) {
      this.logger.error(
        `Failed to restore repeat prescription: ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find all active repeat prescriptions across a workspace.
   *
   * Convenience method for getting all active prescriptions without pagination.
   *
   * @param workspaceId - Tenant workspace ID
   * @returns Array of active repeat prescription responses
   */
  async findActive(
    workspaceId: string,
  ): Promise<RepeatPrescriptionResponseDto[]> {
    this.logger.debug('Finding all active repeat prescriptions');

    const prescriptions = await this.repeatPrescriptionRepository.find({
      where: {
        workspaceId,
        status: PrescriptionStatus.ACTIVE,
        deletedAt: IsNull(),
      },
      order: { createdAt: 'DESC' },
    });

    return prescriptions.map((p) => RepeatPrescriptionResponseDto.fromEntity(p));
  }

  /**
   * Get medication usage analytics.
   *
   * Aggregates prescription counts grouped by medicine name to identify
   * the most frequently prescribed medications in the workspace.
   *
   * @param workspaceId - Tenant workspace ID
   * @param limit - Maximum number of results (default 20)
   * @returns Array of { medicine, count } sorted by count descending
   */
  async getMedicationUsageAnalytics(
    workspaceId: string,
    limit: number = 20,
  ): Promise<{ medicine: string; count: number }[]> {
    this.logger.debug('Getting medication usage analytics');

    const result = await this.repeatPrescriptionRepository
      .createQueryBuilder('rp')
      .select('rp.medicine', 'medicine')
      .addSelect('COUNT(*)', 'count')
      .where('rp.workspaceId = :workspaceId', { workspaceId })
      .andWhere('rp.deletedAt IS NULL')
      .groupBy('rp.medicine')
      .orderBy('count', 'DESC')
      .limit(limit)
      .getRawMany();

    return result.map((r) => ({
      medicine: r.medicine,
      count: parseInt(r.count, 10),
    }));
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /**
   * Calculate next due date based on repeat interval
   */
  private calculateNextDueDate(
    fromDate: Date,
    interval: number,
    unit: string,
  ): Date {
    const date = new Date(fromDate);
    date.setHours(0, 0, 0, 0);

    switch (unit) {
      case 'days':
        return add(date, { days: interval });
      case 'weeks':
        return add(date, { weeks: interval });
      case 'months':
        return add(date, { months: interval });
      case 'years':
        return add(date, { years: interval });
      default:
        throw new BadRequestException(`Invalid interval unit: ${unit}`);
    }
  }
}
