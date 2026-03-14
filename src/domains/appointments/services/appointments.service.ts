import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppointmentRepository } from '../repositories/appointment.repository';
import { CreateAppointmentDto } from '../dtos/create-appointment.dto';
import { UpdateAppointmentDto } from '../dtos/update-appointment.dto';
import { QueryAppointmentsDto } from '../dtos/query-appointments.dto';
import { AppointmentResponseDto } from '../dtos/appointment-response.dto';
import { PaginatedAppointmentsResponseDto } from '../dtos/paginated-appointments-response.dto';
import { Appointment } from '../entities/appointment.entity';
import { Patient } from '../../patients/entities/patient.entity';
import { Consultation } from '../../consultations/entities/consultation.entity';
import { PatientInsurance } from '../../insurance/entities/patient-insurance.entity';
import { AppointmentStatus, ConsultationStatus, PaymentMethodType } from '../../../common/enums';
import { LoggerService } from '../../../common/logger/logger.service';
import { MemberType } from '../../insurance/entities/patient-insurance.entity';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { AuditEventType, AuditOutcome } from '../../../common/enums';

/**
 * Appointments Service
 * Handles all business logic for appointment management
 *
 * Features:
 * - Create/Update appointments with insurance validation
 * - Multi-tenancy support via workspaceId
 * - Automatic patient insurance creation/update
 * - Transaction handling for atomic operations
 * - Appointment status transitions
 * - Consultation synchronization
 */
@Injectable()
export class AppointmentsService {
  constructor(
    private readonly repository: AppointmentRepository,
    @InjectRepository(Patient)
    private readonly patientRepository: Repository<Patient>,
    @InjectRepository(Consultation)
    private readonly consultationRepository: Repository<Consultation>,
    @InjectRepository(PatientInsurance)
    private readonly patientInsuranceRepository: Repository<PatientInsurance>,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext('AppointmentsService');
  }

  /**
   * Create appointment with optional patient insurance update
   * Uses transaction to ensure atomicity
   */
  async create(
    dto: CreateAppointmentDto,
    userId: string,
    workspaceId: string,
  ): Promise<AppointmentResponseDto> {
    this.logger.log(`Creating appointment for patient ${dto.patientId}`);

    // Validate insurance details if payment method is INSURANCE
    this.validateInsuranceDetails(dto);

    try {
      // Use transaction for atomic operation
      const appointmentWithRelations = await this.dataSource.transaction(async (manager) => {
        // 1. Find patient
        const patient = await manager.findOne(Patient, {
          where: { id: dto.patientId, workspaceId },
          relations: ['insurance'],
        });

        if (!patient) {
          this.logger.warn(`Patient not found: ${dto.patientId}`);
          throw new NotFoundException('Patient not found');
        }

        // 2. ✅ Idempotency: reject exact duplicate (same patient + date + time)
        // Appointments are first-come-first-served — a patient may hold multiple
        // active appointments; only a true slot collision is rejected.
        const exactDuplicate = await manager.findOne(Appointment, {
          where: {
            workspaceId,
            patientId: dto.patientId,
            date: new Date(dto.date) as any,
            time: dto.time,
          },
        });
        if (exactDuplicate) {
          throw new BadRequestException(
            'An appointment already exists for this patient at the same date and time.',
          );
        }

        // 3. Update or create patient insurance if flag is set
        if (
          dto.paymentMethod === PaymentMethodType.INSURANCE &&
          dto.updatePatientInsurance
        ) {
          this.logger.log(`Updating patient insurance for patient ${dto.patientId}`);
          await this.updateOrCreatePatientInsurance(
            manager,
            patient,
            workspaceId,
            dto.insuranceProviderId!,
            dto.schemeId!,
            dto.membershipNumber!,
            dto.memberType!,
          );
        }

        // 3. Create appointment
        const appointment = manager.create(Appointment, {
          workspaceId,
          type: dto.type,
          date: new Date(dto.date),
          time: dto.time,
          paymentMethod: dto.paymentMethod,
          status: dto.status || AppointmentStatus.SCHEDULED,
          patientId: dto.patientId,
          consultationId: dto.consultationId,
          transcriptionId: dto.transcriptionId || '',
          userId,
          isActive: true,
        });

        const savedAppointment = await manager.save(Appointment, appointment);
        this.logger.log(`Appointment created with ID: ${savedAppointment.id}`);

        // 4. Load with relations for response
        const appointmentWithRelations = await manager.findOne(Appointment, {
          where: { id: savedAppointment.id },
          relations: [
            'patient',
            'patient.insurance',
            'patient.insurance.insuranceProvider',
            'patient.insurance.scheme',
            'patientBill',
          ],
        });

        return appointmentWithRelations;
      });

      // Audit log after successful creation (non-blocking)
      try {
        await this.auditLogService.log({
          userId,
          action: 'CREATE_APPOINTMENT',
          eventType: AuditEventType.CREATE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'Appointment',
          resourceId: appointmentWithRelations!.id,
          patientId: dto.patientId,
          metadata: {
            appointmentType: dto.type,
            paymentMethod: dto.paymentMethod,
            date: dto.date,
          },
        }, workspaceId);
      } catch (auditError) {
        this.logger.error('Failed to create audit log', auditError.stack);
      }

      return AppointmentResponseDto.fromEntity(appointmentWithRelations!);
    } catch (error) {
      // Audit log for failed creation
      try {
        await this.auditLogService.log({
          userId,
          action: 'CREATE_APPOINTMENT',
          eventType: AuditEventType.CREATE,
          outcome: AuditOutcome.FAILURE,
          resourceType: 'Appointment',
          patientId: dto.patientId,
          metadata: { error: error.message },
        }, workspaceId);
      } catch (auditError) {
        this.logger.error('Failed to create audit log', auditError.stack);
      }
      throw error;
    }
  }

  /**
   * Update appointment with optional patient insurance update
   * Uses transaction to ensure atomicity
   */
  async update(
    id: string,
    dto: UpdateAppointmentDto,
    userId: string,
    workspaceId: string,
  ): Promise<AppointmentResponseDto> {
    this.logger.log(`Updating appointment ${id}`);

    // Validate insurance details if payment method is INSURANCE
    if (dto.paymentMethod === PaymentMethodType.INSURANCE) {
      this.validateInsuranceDetails(dto);
    }

    try {
      const result = await this.dataSource.transaction(async (manager) => {
        // 1. Find appointment with patient
        const appointment = await manager.findOne(Appointment, {
          where: { id, workspaceId },
          relations: ['patient', 'patient.insurance'],
        });

        if (!appointment) {
          this.logger.warn(`Appointment not found: ${id}`);
          throw new NotFoundException('Appointment not found');
        }

        // Capture previous state for audit
        const previousState = {
          type: appointment.type,
          date: appointment.date,
          status: appointment.status,
          paymentMethod: appointment.paymentMethod,
        };

        // 2. Update or create patient insurance if flag is set
        if (
          dto.paymentMethod === PaymentMethodType.INSURANCE &&
          dto.updatePatientInsurance &&
          dto.insuranceProviderId &&
          dto.schemeId &&
          dto.membershipNumber &&
          dto.memberType
        ) {
          this.logger.log(`Updating patient insurance for appointment ${id}`);
          await this.updateOrCreatePatientInsurance(
            manager,
            appointment.patient!,
            workspaceId,
            dto.insuranceProviderId,
            dto.schemeId,
            dto.membershipNumber,
            dto.memberType,
          );
        }

        // 3. Update appointment
        if (dto.type !== undefined) appointment.type = dto.type;
        if (dto.date !== undefined) appointment.date = new Date(dto.date);
        if (dto.time !== undefined) appointment.time = dto.time;
        if (dto.paymentMethod !== undefined) appointment.paymentMethod = dto.paymentMethod;
        if (dto.status !== undefined) appointment.status = dto.status;
        if (dto.isActive !== undefined) appointment.isActive = dto.isActive;
        if (dto.consultationId !== undefined) appointment.consultationId = dto.consultationId;
        if (dto.transcriptionId !== undefined) appointment.transcriptionId = dto.transcriptionId;

        const savedAppointment = await manager.save(Appointment, appointment);
        this.logger.log(`Appointment updated: ${id}`);

        // 4. Load with relations for response
        const appointmentWithRelations = await manager.findOne(Appointment, {
          where: { id: savedAppointment.id },
          relations: [
            'patient',
            'patient.insurance',
            'patient.insurance.insuranceProvider',
            'patient.insurance.scheme',
            'patientBill',
          ],
        });

        return { appointmentWithRelations, previousState };
      });

      // Audit log after successful update (non-blocking)
      try {
        await this.auditLogService.log({
          userId,
          action: 'UPDATE_APPOINTMENT',
          eventType: AuditEventType.UPDATE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'Appointment',
          resourceId: id,
          patientId: result.appointmentWithRelations!.patientId,
          previousState: result.previousState,
          newState: {
            type: result.appointmentWithRelations!.type,
            date: result.appointmentWithRelations!.date,
            status: result.appointmentWithRelations!.status,
            paymentMethod: result.appointmentWithRelations!.paymentMethod,
          },
        }, workspaceId);
      } catch (auditError) {
        this.logger.error('Failed to create audit log', auditError.stack);
      }

      return AppointmentResponseDto.fromEntity(result.appointmentWithRelations!);
    } catch (error) {
      // Audit log for failed update
      try {
        await this.auditLogService.log({
          userId,
          action: 'UPDATE_APPOINTMENT',
          eventType: AuditEventType.UPDATE,
          outcome: AuditOutcome.FAILURE,
          resourceType: 'Appointment',
          resourceId: id,
          metadata: { error: error.message },
        }, workspaceId);
      } catch (auditError) {
        this.logger.error('Failed to create audit log', auditError.stack);
      }
      throw error;
    }
  }

  /**
   * Update or create patient insurance
   * Private helper method for transaction
   */
  private async updateOrCreatePatientInsurance(
    manager: any,
    patient: Patient,
    workspaceId: string,
    insuranceProviderId: string,
    schemeId: string,
    membershipNumber: string,
    memberType: 'PRINCIPAL' | 'DEPENDENT',
  ): Promise<PatientInsurance> {
    // Check if patient already has insurance
    let patientInsurance = await manager.findOne(PatientInsurance, {
      where: { patientId: patient.id },
      relations: ['insuranceProvider', 'scheme'],
    });

    const now = new Date();
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

    if (patientInsurance) {
      // UPDATE existing insurance
      this.logger.log(`Updating existing insurance for patient ${patient.id}`);
      patientInsurance.insuranceProviderId = insuranceProviderId;
      patientInsurance.schemeId = schemeId;
      patientInsurance.membershipNumber = membershipNumber;
      patientInsurance.memberType = memberType === 'PRINCIPAL' ? MemberType.PRINCIPAL : MemberType.DEPENDENT;
      patientInsurance.status = 'ACTIVE' as any;

      const savedInsurance = await manager.save(
        PatientInsurance,
        patientInsurance,
      );

      return savedInsurance;
    } else {
      // CREATE new insurance
      this.logger.log(`Creating new insurance for patient ${patient.id}`);
      const newInsurance = manager.create(PatientInsurance, {
        patientId: patient.id,
        insuranceProviderId,
        schemeId,
        membershipNumber,
        memberType: memberType === 'PRINCIPAL' ? MemberType.PRINCIPAL : MemberType.DEPENDENT,
        status: 'ACTIVE' as any,
        isPrimary: true,
        priority: 1,
        effectiveDate: now,
        expiryDate: oneYearFromNow,
        enrollmentDate: now,
      });

      const savedInsurance = await manager.save(PatientInsurance, newInsurance);

      return savedInsurance;
    }
  }

  /**
   * Validate insurance details before creating/updating appointment
   */
  private validateInsuranceDetails(
    dto: CreateAppointmentDto | UpdateAppointmentDto,
  ): void {
    if (dto.paymentMethod === PaymentMethodType.INSURANCE) {
      const errors: string[] = [];

      if (!dto.insuranceProviderId) {
        errors.push('Insurance provider is required for INSURANCE payment method');
      }

      if (!dto.schemeId) {
        errors.push('Insurance scheme is required for INSURANCE payment method');
      }

      if (!dto.membershipNumber) {
        errors.push('Membership number is required for INSURANCE payment method');
      }

      if (!dto.memberType) {
        errors.push('Member type is required for INSURANCE payment method');
      }

      if (errors.length > 0) {
        this.logger.warn(`Insurance validation failed: ${errors.join(', ')}`);
        throw new BadRequestException(errors);
      }
    }
  }

  /**
   * Build paginated response
   */
  private async buildPaginatedResponse(
    data: Appointment[],
    total: number,
    query: QueryAppointmentsDto,
  ): Promise<PaginatedAppointmentsResponseDto> {
    return {
      data: data.map(AppointmentResponseDto.fromEntity),
      meta: {
        total,
        page: query.page || 1,
        limit: query.limit || 10,
        totalPages: Math.ceil(total / (query.limit || 10)),
      },
    };
  }

  /**
   * Find all appointments with filters and pagination
   */
  async findAll(
    query: QueryAppointmentsDto,
    workspaceId: string,
  ): Promise<PaginatedAppointmentsResponseDto> {
    this.logger.log(`Finding all appointments for workspace ${workspaceId}`);
    query.workspaceId = workspaceId;
    const [appointments, total] = await this.repository.findWithFilters(query);
    return this.buildPaginatedResponse(appointments, total, query);
  }

  /**
   * Find all active appointments with filters
   */
  async findAllActive(
    query: QueryAppointmentsDto,
    workspaceId: string,
  ): Promise<PaginatedAppointmentsResponseDto> {
    this.logger.log(`Finding active appointments for workspace ${workspaceId}`);
    query.workspaceId = workspaceId;
    const [appointments, total] = await this.repository.findActiveWithFilters(query);
    return this.buildPaginatedResponse(appointments, total, query);
  }

  /**
   * Find one appointment by ID
   */
  async findOne(id: string, workspaceId: string, userId?: string): Promise<AppointmentResponseDto> {
    this.logger.log(`Finding appointment ${id}`);
    const appointment = await this.repository.findOneWithDetails(id, workspaceId);

    if (!appointment) {
      this.logger.warn(`Appointment not found: ${id}`);
      throw new NotFoundException('Appointment not found');
    }

    // Audit log for appointment access (HIPAA requirement) - non-blocking
    if (userId) {
      try {
        await this.auditLogService.log({
          userId,
          action: 'VIEW_APPOINTMENT',
          eventType: AuditEventType.READ,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'Appointment',
          resourceId: id,
          patientId: appointment.patientId,
        }, workspaceId);
      } catch (auditError) {
        this.logger.error('Failed to create audit log', auditError.stack);
      }
    }

    return AppointmentResponseDto.fromEntity(appointment);
  }

  /**
   * Mark appointment as done (completed)
   * Updates consultation status as well
   */
  async markAsDone(id: string, workspaceId: string, userId?: string): Promise<AppointmentResponseDto> {
    this.logger.log(`Marking appointment ${id} as done`);

    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const appointment = await manager.findOne(Appointment, {
          where: { id, workspaceId },
        });

        if (!appointment) {
          this.logger.warn(`Appointment not found: ${id}`);
          throw new NotFoundException('Appointment not found');
        }

        const previousStatus = appointment.status;

        // Update appointment status
        appointment.isActive = false;
        appointment.status = AppointmentStatus.COMPLETED;
        const savedAppointment = await manager.save(Appointment, appointment);

        // Update consultation status if exists
        if (appointment.consultationId) {
          const consultation = await manager.findOne(Consultation, {
            where: { id: appointment.consultationId },
          });

          if (consultation) {
            this.logger.log(`Updating consultation ${consultation.id} status to COMPLETED`);
            consultation.status = ConsultationStatus.COMPLETED;
            await manager.save(Consultation, consultation);
          }
        }

        const updatedAppointment = await manager.findOne(Appointment, {
          where: { id: savedAppointment.id },
          relations: ['patientBill'],
        });

        return { updatedAppointment: updatedAppointment!, previousStatus };
      });

      // Audit log after successful completion (non-blocking)
      if (userId) {
        try {
          await this.auditLogService.log({
            userId,
            action: 'COMPLETE_APPOINTMENT',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'Appointment',
            resourceId: id,
            patientId: result.updatedAppointment.patientId,
            previousState: { status: result.previousStatus },
            newState: { status: AppointmentStatus.COMPLETED },
          }, workspaceId);
        } catch (auditError) {
          this.logger.error('Failed to create audit log', auditError.stack);
        }
      }

      return AppointmentResponseDto.fromEntity(result.updatedAppointment);
    } catch (error) {
      // Audit log for failed completion
      if (userId) {
        try {
          await this.auditLogService.log({
            userId,
            action: 'COMPLETE_APPOINTMENT',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.FAILURE,
            resourceType: 'Appointment',
            resourceId: id,
            metadata: { error: error.message },
          }, workspaceId);
        } catch (auditError) {
          this.logger.error('Failed to create audit log', auditError.stack);
        }
      }
      throw error;
    }
  }

  /**
   * Cancel appointment
   * Updates consultation status as well
   */
  async cancelAppointment(id: string, workspaceId: string, userId?: string): Promise<AppointmentResponseDto> {
    this.logger.log(`Cancelling appointment ${id}`);

    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const appointment = await manager.findOne(Appointment, {
          where: { id, workspaceId },
        });

        if (!appointment) {
          this.logger.warn(`Appointment not found: ${id}`);
          throw new NotFoundException('Appointment not found');
        }

        const previousStatus = appointment.status;

        // Update appointment status
        appointment.isActive = false;
        appointment.status = AppointmentStatus.CANCELLED;
        const savedAppointment = await manager.save(Appointment, appointment);

        // Update consultation status if exists
        if (appointment.consultationId) {
          const consultation = await manager.findOne(Consultation, {
            where: { id: appointment.consultationId },
          });

          if (consultation) {
            this.logger.log(`Updating consultation ${consultation.id} status to COMPLETED (cancelled)`);
            consultation.status = ConsultationStatus.COMPLETED;
            await manager.save(Consultation, consultation);
          }
        }

        const updatedAppointment = await manager.findOne(Appointment, {
          where: { id: savedAppointment.id },
          relations: ['patientBill'],
        });

        return { updatedAppointment: updatedAppointment!, previousStatus };
      });

      // Audit log after successful cancellation (non-blocking)
      if (userId) {
        try {
          await this.auditLogService.log({
            userId,
            action: 'CANCEL_APPOINTMENT',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'Appointment',
            resourceId: id,
            patientId: result.updatedAppointment.patientId,
            previousState: { status: result.previousStatus },
            newState: { status: AppointmentStatus.CANCELLED },
          }, workspaceId);
        } catch (auditError) {
          this.logger.error('Failed to create audit log', auditError.stack);
        }
      }

      return AppointmentResponseDto.fromEntity(result.updatedAppointment);
    } catch (error) {
      // Audit log for failed cancellation
      if (userId) {
        try {
          await this.auditLogService.log({
            userId,
            action: 'CANCEL_APPOINTMENT',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.FAILURE,
            resourceType: 'Appointment',
            resourceId: id,
            metadata: { error: error.message },
          }, workspaceId);
        } catch (auditError) {
          this.logger.error('Failed to create audit log', auditError.stack);
        }
      }
      throw error;
    }
  }

  /**
   * Soft delete appointment
   */
  async remove(id: string, workspaceId: string): Promise<void> {
    this.logger.log(`Removing appointment ${id}`);
    const appointment = await this.repository.findOne({
      where: { id, workspaceId },
    });

    if (!appointment) {
      this.logger.warn(`Appointment not found: ${id}`);
      throw new NotFoundException('Appointment not found');
    }

    await this.repository.softDelete(id);
    this.logger.log(`Appointment removed: ${id}`);
  }
}
