import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Prescription } from '../entities/prescription.entity';
import { Appointment } from '../../appointments/entities/appointment.entity';
import { Consultation } from '../../consultations/entities/consultation.entity';
import { PrescriptionRepository } from '../repositories/prescription.repository';
import { PatientRepository } from '../../patients/repositories/patient.repository';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { AuditEventType, AuditOutcome } from '../../../common/enums';
import {
  CreatePrescriptionDto,
  UpdatePrescriptionDto,
  PrescriptionQueryDto,
  PrescriptionResponseDto,
} from '../dto/prescription';
import { PaginatedMetaResponseDto as PaginatedResponseDto } from '../dto/common/paginated-response.dto';

/**
 * Service for managing prescriptions
 * Handles CRUD operations with HIPAA-compliant audit logging and multi-tenancy support
 */
@Injectable()
export class PrescriptionsService {
  constructor(
    private readonly prescriptionRepository: PrescriptionRepository,
    private readonly patientRepository: PatientRepository,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext('PrescriptionsService');
  }

  /**
   * Create a new prescription with audit logging
   */
  async create(
    dto: CreatePrescriptionDto,
    userId: string,
    workspaceId: string,
  ): Promise<PrescriptionResponseDto> {
    this.logger.log(
      `Creating prescription for appointment: ${dto.appointmentId}, workspace: ${workspaceId}`,
    );

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
      relations: ['appointment'],
    });

    if (!consultation) {
      this.logger.error(`Consultation not found: ${dto.consultationId}`);
      throw new NotFoundException(
        `Consultation with ID ${dto.consultationId} not found`,
      );
    }

    // Validate patient exists in workspace
    const patient = await this.patientRepository.findOne({
      where: { id: consultation.patientId, workspaceId },
    });

    if (!patient) {
      this.logger.error(`Patient not found: ${consultation.patientId}`);
      throw new NotFoundException(
        `Patient with ID ${consultation.patientId} not found`,
      );
    }

    // Create prescription entity
    const prescription = this.prescriptionRepository.create({
      ...dto,
    });

    try {
      // Save prescription to database
      const savedPrescription = await this.prescriptionRepository.save(prescription);

      this.logger.log(
        `Prescription created successfully - ID: ${savedPrescription.id}, appointment: ${dto.appointmentId}`,
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
            patientId: consultation.patientId,
            metadata: {
              appointmentId: dto.appointmentId,
              consultationId: dto.consultationId,
              medicine: dto.medicine,
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

      return PrescriptionResponseDto.fromEntity(savedPrescription);
    } catch (error) {
      this.logger.error(
        `Failed to create prescription for appointment: ${dto.appointmentId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find all prescriptions with filters and pagination
   */
  async findAll(
    query: PrescriptionQueryDto,
    workspaceId: string,
  ): Promise<PaginatedResponseDto<PrescriptionResponseDto>> {
    this.logger.log(`Finding all prescriptions for workspace: ${workspaceId}`);

    try {
      const [prescriptions, total] =
        await this.prescriptionRepository.findWithFilters(query, workspaceId);

      return {
        data: prescriptions.map((prescription) =>
          PrescriptionResponseDto.fromEntity(prescription),
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
        `Failed to find prescriptions for workspace: ${workspaceId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find prescriptions by patient ID with pagination
   */
  async findByPatient(
    patientId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedResponseDto<PrescriptionResponseDto>> {
    this.logger.log(
      `Finding prescriptions by patient: ${patientId}, workspace: ${workspaceId}`,
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

      const [prescriptions, total] =
        await this.prescriptionRepository.findByPatient(
          patientId,
          workspaceId,
          page,
          Math.min(limit, 100),
        );

      // Audit log for VIEW_PRESCRIPTION (non-blocking, HIPAA requirement)
      try {
        await this.auditLogService.log(
          {
            userId: 'system', // Will be replaced by actual userId in controller
            action: 'VIEW_PRESCRIPTION',
            eventType: AuditEventType.READ,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'Prescription',
            patientId,
            metadata: {
              count: prescriptions.length,
              page,
              limit,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for prescription view - patient: ${patientId}`,
          auditError instanceof Error ? auditError.stack : String(auditError),
        );
      }

      return {
        data: prescriptions.map((prescription) =>
          PrescriptionResponseDto.fromEntity(prescription),
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
        `Failed to find prescriptions by patient: ${patientId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find prescriptions by appointment ID
   */
  async findByAppointment(
    appointmentId: string,
    workspaceId: string,
  ): Promise<PrescriptionResponseDto[]> {
    this.logger.log(
      `Finding prescriptions by appointment: ${appointmentId}, workspace: ${workspaceId}`,
    );

    try {
      // Validate appointment exists in workspace
      const appointmentRepo = this.dataSource.getRepository(Appointment);
      const appointment = await appointmentRepo.findOne({
        where: { id: appointmentId, workspaceId },
      });

      if (!appointment) {
        this.logger.error(`Appointment not found: ${appointmentId}`);
        throw new NotFoundException(
          `Appointment with ID ${appointmentId} not found`,
        );
      }

      const prescriptions = await this.prescriptionRepository.findByAppointment(
        appointmentId,
        workspaceId,
      );

      return prescriptions.map((prescription) =>
        PrescriptionResponseDto.fromEntity(prescription),
      );
    } catch (error) {
      this.logger.error(
        `Failed to find prescriptions by appointment: ${appointmentId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find prescriptions by consultation ID
   */
  async findByConsultation(
    consultationId: string,
    workspaceId: string,
  ): Promise<PrescriptionResponseDto[]> {
    this.logger.log(
      `Finding prescriptions by consultation: ${consultationId}, workspace: ${workspaceId}`,
    );

    try {
      // Validate consultation exists
      const consultationRepo = this.dataSource.getRepository(Consultation);
      const consultation = await consultationRepo.findOne({
        where: { id: consultationId },
        relations: ['appointment'],
      });

      if (!consultation || consultation.appointment?.workspaceId !== workspaceId) {
        this.logger.error(`Consultation not found: ${consultationId}`);
        throw new NotFoundException(
          `Consultation with ID ${consultationId} not found`,
        );
      }

      const prescriptions =
        await this.prescriptionRepository.findByConsultation(
          consultationId,
          workspaceId,
        );

      return prescriptions.map((prescription) =>
        PrescriptionResponseDto.fromEntity(prescription),
      );
    } catch (error) {
      this.logger.error(
        `Failed to find prescriptions by consultation: ${consultationId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find prescriptions by note ID.
   *
   * Returns all prescriptions linked to a specific care note.
   * Used for cross-service queries (e.g., from CareNotesService).
   *
   * @param noteId - Care note ID
   * @param workspaceId - Tenant workspace ID
   * @returns Array of prescription responses
   */
  async findByNoteId(
    noteId: string,
    workspaceId: string,
  ): Promise<PrescriptionResponseDto[]> {
    this.logger.debug(`Finding prescriptions by note: ${noteId}`);

    try {
      const prescriptions = await this.prescriptionRepository.find({
        where: { noteId, workspaceId },
        order: { createdAt: 'DESC' },
      });

      return prescriptions.map((p) => PrescriptionResponseDto.fromEntity(p));
    } catch (error) {
      this.logger.error(
        `Failed to find prescriptions by note: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find single prescription by ID
   */
  async findOne(
    id: string,
    workspaceId: string,
  ): Promise<PrescriptionResponseDto> {
    this.logger.log(
      `Finding prescription by ID: ${id}, workspace: ${workspaceId}`,
    );

    try {
      const prescription =
        await this.prescriptionRepository.findOneByIdAndWorkspace(
          id,
          workspaceId,
        );

      if (!prescription) {
        this.logger.error(`Prescription not found: ${id}`);
        throw new NotFoundException(`Prescription with ID ${id} not found`);
      }

      // Get patient ID for audit logging
      const consultationRepo = this.dataSource.getRepository(Consultation);
      const consultation = await consultationRepo.findOne({
        where: { id: prescription.consultationId },
      });

      // Audit log for VIEW_PRESCRIPTION (non-blocking, HIPAA requirement)
      try {
        await this.auditLogService.log(
          {
            userId: 'system', // Will be replaced by actual userId in controller
            action: 'VIEW_PRESCRIPTION',
            eventType: AuditEventType.READ,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'Prescription',
            resourceId: id,
            patientId: consultation?.patientId,
            metadata: {
              medicine: prescription.medicine,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for prescription view - ID: ${id}`,
          auditError instanceof Error ? auditError.stack : String(auditError),
        );
      }

      return PrescriptionResponseDto.fromEntity(prescription);
    } catch (error) {
      this.logger.error(
        `Failed to find prescription by ID: ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Update a prescription entry
   */
  async update(
    id: string,
    dto: UpdatePrescriptionDto,
    userId: string,
    workspaceId: string,
  ): Promise<PrescriptionResponseDto> {
    this.logger.log(`Updating prescription: ${id}, workspace: ${workspaceId}`);

    try {
      const prescription =
        await this.prescriptionRepository.findOneByIdAndWorkspace(
          id,
          workspaceId,
        );

      if (!prescription) {
        this.logger.error(`Prescription not found: ${id}`);
        throw new NotFoundException(`Prescription with ID ${id} not found`);
      }

      // Validate appointment if being updated
      if (dto.appointmentId && dto.appointmentId !== prescription.appointmentId) {
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
      }

      // Validate consultation if being updated
      if (dto.consultationId && dto.consultationId !== prescription.consultationId) {
        const consultationRepo = this.dataSource.getRepository(Consultation);
        const consultation = await consultationRepo.findOne({
          where: { id: dto.consultationId },
          relations: ['appointment'],
        });

        if (!consultation || consultation.appointment?.workspaceId !== workspaceId) {
          this.logger.error(`Consultation not found: ${dto.consultationId}`);
          throw new NotFoundException(
            `Consultation with ID ${dto.consultationId} not found`,
          );
        }
      }

      // Get patient ID for audit logging
      const consultationRepo = this.dataSource.getRepository(Consultation);
      const consultation = await consultationRepo.findOne({
        where: { id: prescription.consultationId },
      });

      // Update fields
      Object.assign(prescription, dto);

      const updatedPrescription = await this.prescriptionRepository.save(prescription);

      this.logger.log(`Prescription updated successfully - ID: ${id}`);

      // Audit log for UPDATE_PRESCRIPTION (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'UPDATE_PRESCRIPTION',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'Prescription',
            resourceId: id,
            patientId: consultation?.patientId,
            metadata: {
              updates: Object.keys(dto),
              medicine: updatedPrescription.medicine,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for prescription update - ID: ${id}`,
          auditError instanceof Error ? auditError.stack : String(auditError),
        );
      }

      return PrescriptionResponseDto.fromEntity(updatedPrescription);
    } catch (error) {
      this.logger.error(
        `Failed to update prescription: ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Soft delete a prescription entry
   */
  async remove(
    id: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    this.logger.log(`Deleting prescription: ${id}, workspace: ${workspaceId}`);

    try {
      const prescription =
        await this.prescriptionRepository.findOneByIdAndWorkspace(
          id,
          workspaceId,
        );

      if (!prescription) {
        this.logger.error(`Prescription not found: ${id}`);
        throw new NotFoundException(`Prescription with ID ${id} not found`);
      }

      // Get patient ID for audit logging
      const consultationRepo = this.dataSource.getRepository(Consultation);
      const consultation = await consultationRepo.findOne({
        where: { id: prescription.consultationId },
      });

      // Soft delete
      prescription.deletedAt = new Date();
      await this.prescriptionRepository.save(prescription);

      this.logger.log(`Prescription deleted successfully - ID: ${id}`);

      // Audit log for DELETE_PRESCRIPTION (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'DELETE_PRESCRIPTION',
            eventType: AuditEventType.DELETE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'Prescription',
            resourceId: id,
            patientId: consultation?.patientId,
            metadata: {
              medicine: prescription.medicine,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for prescription deletion - ID: ${id}`,
          auditError instanceof Error ? auditError.stack : String(auditError),
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to delete prescription: ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}
