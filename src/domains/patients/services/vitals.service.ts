import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Vital } from '../entities/vital.entity';
import { VitalRepository } from '../repositories/vital.repository';
import { PatientRepository } from '../repositories/patient.repository';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { AuditEventType, AuditOutcome } from '../../../common/enums';
import {
  CreateVitalDto,
  UpdateVitalDto,
  VitalQueryDto,
  VitalResponseDto,
  PaginatedVitalsResponseDto,
} from '../dto/vital';

/**
 * Service for managing patient vital signs
 * Handles CRUD operations with audit logging and multi-tenancy support
 *
 * Performance notes:
 *  • Audit logs are fire-and-forget (void + .catch) — never block the response.
 *  • Patient validation uses count() instead of findOne() (no entity hydration).
 *  • Encryption/decryption handled by VitalRepository (EncryptedRepository base).
 */
@Injectable()
export class VitalsService {
  constructor(
    private readonly vitalRepository: VitalRepository,
    private readonly patientRepository: PatientRepository,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext('VitalsService');
  }

  /**
   * Create a new vital entry with audit logging
   */
  async create(
    dto: CreateVitalDto,
    userId: string,
    workspaceId: string,
  ): Promise<VitalResponseDto> {
    this.logger.log(`Creating vital for patient: ${dto.patientId}, workspace: ${workspaceId}`);

    // Validate patient exists — lightweight count, no entity hydration
    const patientExists = await this.patientRepository.count({
      where: { id: dto.patientId, workspaceId },
    });

    if (!patientExists) {
      this.logger.error(`Patient not found: ${dto.patientId}`);
      throw new NotFoundException(`Patient with ID ${dto.patientId} not found`);
    }

    // Create vital entity
    const vital = this.vitalRepository.create({
      ...dto,
      workspaceId,
      userId,
      time: dto.time || new Date().toISOString().split('T')[1].split('.')[0], // HH:mm:ss format
    });

    // Save vital to database (EncryptedRepository auto-encrypts sensitive fields)
    const savedVital = await this.vitalRepository.save(vital);

    this.logger.log(`Vital created successfully - ID: ${savedVital.id}, patient: ${dto.patientId}`);

    // Audit log — fire-and-forget
    void this.auditLogService
      .log(
        {
          userId,
          action: 'CREATE_VITAL',
          eventType: AuditEventType.CREATE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'Vital',
          resourceId: savedVital.id,
          patientId: dto.patientId,
          metadata: {
            appointmentId: dto.appointmentId,
            consultationId: dto.consultationId,
            measurements: {
              temperature: dto.temperature,
              bloodPressure: dto.bloodPressure,
              heartRate: dto.heartRate,
              saturation: dto.saturation,
              gcs: dto.gcs,
              bloodGlucose: dto.bloodGlucose,
              height: dto.height,
              weight: dto.weight,
            },
          },
        },
        workspaceId,
      )
      .catch((e) =>
        this.logger.error(
          `Failed to create audit log for vital creation - ID: ${savedVital.id}`,
          e instanceof Error ? e.stack : String(e),
        ),
      );

    return VitalResponseDto.fromEntity(savedVital);
  }

  /**
   * Find all vitals with filters and pagination
   */
  async findAll(query: VitalQueryDto, workspaceId: string): Promise<PaginatedVitalsResponseDto> {
    this.logger.log(`Finding all vitals for workspace: ${workspaceId}`);

    const [vitals, total] = await this.vitalRepository.findWithFilters(query, workspaceId);

    const page = query.page || 1;
    const limit = query.limit || 10;

    return {
      data: vitals.map((vital) => VitalResponseDto.fromEntity(vital)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Find vitals by patient ID with pagination
   */
  async findByPatient(
    patientId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedVitalsResponseDto> {
    this.logger.log(`Finding vitals by patient: ${patientId}, workspace: ${workspaceId}`);

    // Validate patient exists — lightweight count
    const patientExists = await this.patientRepository.count({
      where: { id: patientId, workspaceId },
    });

    if (!patientExists) {
      this.logger.error(`Patient not found: ${patientId}`);
      throw new NotFoundException(`Patient with ID ${patientId} not found`);
    }

    const [vitals, total] = await this.vitalRepository.findByPatient(patientId, workspaceId, page, limit);

    return {
      data: vitals.map((vital) => VitalResponseDto.fromEntity(vital)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Find vitals by appointment ID with pagination
   */
  async findByAppointment(
    appointmentId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedVitalsResponseDto> {
    this.logger.log(`Finding vitals by appointment: ${appointmentId}, workspace: ${workspaceId}`);

    const [vitals, total] = await this.vitalRepository.findByAppointment(appointmentId, workspaceId, page, limit);

    return {
      data: vitals.map((vital) => VitalResponseDto.fromEntity(vital)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Find the most recent vital entry for an appointment
   */
  async findFirstEntry(appointmentId: string, workspaceId: string): Promise<VitalResponseDto> {
    this.logger.log(`Finding first vital entry for appointment: ${appointmentId}`);

    const vital = await this.vitalRepository.findFirstByAppointment(appointmentId, workspaceId);

    if (!vital) {
      this.logger.error(`No vitals found for appointment: ${appointmentId}`);
      throw new NotFoundException(`No vitals found for appointment ${appointmentId}`);
    }

    return VitalResponseDto.fromEntity(vital);
  }

  /**
   * Find a single vital by ID
   * EncryptedRepository.findOne() auto-decrypts sensitive fields.
   */
  async findOne(id: string, workspaceId: string, userId?: string): Promise<VitalResponseDto> {
    this.logger.log(`Finding vital by ID: ${id}, workspace: ${workspaceId}`);

    const vital = await this.vitalRepository.findOne({
      where: { id, workspaceId },
    });

    if (!vital) {
      this.logger.error(`Vital not found: ${id}`);
      throw new NotFoundException(`Vital with ID ${id} not found`);
    }

    // Audit log — fire-and-forget (only if userId provided)
    if (userId) {
      void this.auditLogService
        .log(
          {
            userId,
            action: 'VIEW_VITAL',
            eventType: AuditEventType.READ,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'Vital',
            resourceId: id,
            patientId: vital.patientId,
            metadata: {
              appointmentId: vital.appointmentId,
              consultationId: vital.consultationId,
            },
          },
          workspaceId,
        )
        .catch((e) =>
          this.logger.error(
            `Failed to create audit log for vital view - ID: ${id}`,
            e instanceof Error ? e.stack : String(e),
          ),
        );
    }

    return VitalResponseDto.fromEntity(vital);
  }

  /**
   * Update a vital entry with audit logging
   */
  async update(
    id: string,
    dto: UpdateVitalDto,
    userId: string,
    workspaceId: string,
  ): Promise<VitalResponseDto> {
    this.logger.log(`Updating vital: ${id}, workspace: ${workspaceId}`);

    // Lightweight findOne — no relations. EncryptedRepository auto-decrypts.
    const vital = await this.vitalRepository.findOne({
      where: { id, workspaceId },
    });

    if (!vital) {
      this.logger.error(`Vital not found: ${id}`);
      throw new NotFoundException(`Vital with ID ${id} not found`);
    }

    // Capture only the fields needed for audit (not the entire entity)
    const previousState = {
      temperature: vital.temperature,
      bloodPressure: vital.bloodPressure,
      heartRate: vital.heartRate,
      saturation: vital.saturation,
      gcs: vital.gcs,
      bloodGlucose: vital.bloodGlucose,
      height: vital.height,
      weight: vital.weight,
    };

    // Apply updates (patientId and appointmentId cannot be changed via update)
    Object.assign(vital, dto);

    // Save updated vital (EncryptedRepository auto-encrypts sensitive fields)
    const updatedVital = await this.vitalRepository.save(vital);

    this.logger.log(`Vital updated successfully - ID: ${id}`);

    // Audit log — fire-and-forget
    void this.auditLogService
      .log(
        {
          userId,
          action: 'UPDATE_VITAL',
          eventType: AuditEventType.UPDATE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'Vital',
          resourceId: id,
          patientId: vital.patientId,
          previousState,
          newState: {
            temperature: updatedVital.temperature,
            bloodPressure: updatedVital.bloodPressure,
            heartRate: updatedVital.heartRate,
            saturation: updatedVital.saturation,
            gcs: updatedVital.gcs,
            bloodGlucose: updatedVital.bloodGlucose,
            height: updatedVital.height,
            weight: updatedVital.weight,
          },
          metadata: {
            appointmentId: updatedVital.appointmentId,
            consultationId: updatedVital.consultationId,
            changedFields: Object.keys(dto),
          },
        },
        workspaceId,
      )
      .catch((e) =>
        this.logger.error(
          `Failed to create audit log for vital update - ID: ${id}`,
          e instanceof Error ? e.stack : String(e),
        ),
      );

    return VitalResponseDto.fromEntity(updatedVital);
  }

  /**
   * Soft delete a vital entry with audit logging
   */
  async remove(id: string, userId: string, workspaceId: string): Promise<void> {
    this.logger.log(`Soft deleting vital: ${id}, workspace: ${workspaceId}`);

    // Lightweight findOne — no relations
    const vital = await this.vitalRepository.findOne({
      where: { id, workspaceId },
    });

    if (!vital) {
      this.logger.error(`Vital not found: ${id}`);
      throw new NotFoundException(`Vital with ID ${id} not found`);
    }

    // Soft delete the vital
    const result = await this.vitalRepository.softDelete(id);

    if (result.affected === 0) {
      this.logger.error(`Vital deletion failed - no rows affected: ${id}`);
      throw new NotFoundException(`Vital with ID ${id} not found or already deleted`);
    }

    this.logger.log(`Vital soft deleted successfully - ID: ${id}`);

    // Audit log — fire-and-forget
    void this.auditLogService
      .log(
        {
          userId,
          action: 'DELETE_VITAL',
          eventType: AuditEventType.DELETE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'Vital',
          resourceId: id,
          patientId: vital.patientId,
          metadata: {
            appointmentId: vital.appointmentId,
            consultationId: vital.consultationId,
            deletedAt: new Date().toISOString(),
          },
        },
        workspaceId,
      )
      .catch((e) =>
        this.logger.error(
          `Failed to create audit log for vital deletion - ID: ${id}`,
          e instanceof Error ? e.stack : String(e),
        ),
      );
  }
}
