import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DataSource , IsNull } from 'typeorm';
import { PastMedicalHistory } from '../entities/past-medical-history.entity';
import { MedicalHistoryRepository } from '../repositories/medical-history.repository';
import { PatientRepository } from '../repositories/patient.repository';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { AuditEventType, AuditOutcome } from '../../../common/enums';
import {
  CreateMedicalHistoryDto,
  UpdateMedicalHistoryDto,
  MedicalHistoryQueryDto,
  MedicalHistoryResponseDto,
  PaginatedMedicalHistoryResponseDto,
} from '../dto';

/**
 * Service for managing patient medical history
 * Handles CRUD operations with HIPAA-compliant audit logging
 * Supports ICD-10/ICD-11 and SNOMED CT coding systems
 * Identifies chronic conditions for ongoing management
 */
@Injectable()
export class MedicalHistoryService {
  constructor(
    private readonly medicalHistoryRepository: MedicalHistoryRepository,
    private readonly patientRepository: PatientRepository,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext('MedicalHistoryService');
  }

  /**
   * Create a new medical history entry with audit logging
   * @param dto Medical history data
   * @param userId User ID creating the medical history
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Created medical history
   */
  async create(
    dto: CreateMedicalHistoryDto,
    userId: string,
    workspaceId: string,
  ): Promise<MedicalHistoryResponseDto> {
    this.logger.log(`Creating medical history for patient: ${dto.patientId}, workspace: ${workspaceId}`);

    // Validate patient exists
    const patient = await this.patientRepository.findOne({
      where: { id: dto.patientId, workspaceId },
    });

    if (!patient) {
      this.logger.error(`Patient not found: ${dto.patientId}`);
      throw new NotFoundException(`Patient with ID ${dto.patientId} not found`);
    }

    // Create medical history entity
    const medicalHistory = this.medicalHistoryRepository.create({
      ...dto,
      workspaceId,
      userId,
    });

    try {
      // Save medical history to database
      const savedMedicalHistory = await this.medicalHistoryRepository.save(medicalHistory);

      this.logger.log(`Medical history created successfully - ID: ${savedMedicalHistory.id}, patient: ${dto.patientId}`);

      // Audit log for CREATE_MEDICAL_HISTORY (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'CREATE_MEDICAL_HISTORY',
            eventType: AuditEventType.CREATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'MedicalHistory',
            resourceId: savedMedicalHistory.id,
            patientId: dto.patientId,
            metadata: {
              condition: dto.condition,
              // Details not logged (PHI)
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for medical history creation - ID: ${savedMedicalHistory.id}`, auditError.stack);
      }

      return MedicalHistoryResponseDto.fromEntity(savedMedicalHistory);
    } catch (error) {
      this.logger.error(`Failed to create medical history for patient: ${dto.patientId}`, error.stack);
      throw error;
    }
  }

  /**
   * Find all medical histories with filters and pagination
   * @param query Query parameters with filters
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Paginated medical histories
   */
  async findAll(query: MedicalHistoryQueryDto, workspaceId: string): Promise<PaginatedMedicalHistoryResponseDto> {
    this.logger.log(`Finding all medical histories for workspace: ${workspaceId}`);

    try {
      const page = query.page || 1;
      const limit = Math.min(query.limit || 10, 100); // Max 100 per page

      let histories: PastMedicalHistory[];
      let total: number;

      // Apply filters based on query
      if (query.patientId) {
        [histories, total] = await this.medicalHistoryRepository.findByPatient(
          query.patientId,
          workspaceId,
          page,
          limit,
        );
      } else if (query.condition) {
        [histories, total] = await this.medicalHistoryRepository.searchByCondition(
          query.condition,
          workspaceId,
          page,
          limit,
        );
      } else {
        [histories, total] = await this.medicalHistoryRepository.findActive(
          workspaceId,
          page,
          limit,
        );
      }

      return {
        data: histories.map((history) => MedicalHistoryResponseDto.fromEntity(history)),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to find medical histories for workspace: ${workspaceId}`, error.stack);
      throw error;
    }
  }

  /**
   * Find medical histories by patient ID with pagination
   * @param patientId Patient ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Paginated medical histories
   */
  async findByPatient(
    patientId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedMedicalHistoryResponseDto> {
    this.logger.log(`Finding medical histories by patient: ${patientId}, workspace: ${workspaceId}`);

    try {
      // Validate patient exists
      const patient = await this.patientRepository.findOne({
        where: { id: patientId, workspaceId },
      });

      if (!patient) {
        this.logger.error(`Patient not found: ${patientId}`);
        throw new NotFoundException(`Patient with ID ${patientId} not found`);
      }

      const [histories, total] = await this.medicalHistoryRepository.findByPatient(
        patientId,
        workspaceId,
        page,
        Math.min(limit, 100), // Max 100 per page
      );

      // Audit log for VIEW_MEDICAL_HISTORY (non-blocking, HIPAA requirement)
      try {
        await this.auditLogService.log(
          {
            userId: 'system', // Will be replaced by actual userId in controller
            action: 'VIEW_MEDICAL_HISTORY',
            eventType: AuditEventType.READ,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'MedicalHistory',
            patientId,
            metadata: {
              count: histories.length,
              page,
              limit,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for medical history view - patient: ${patientId}`, auditError.stack);
      }

      return {
        data: histories.map((history) => MedicalHistoryResponseDto.fromEntity(history)),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to find medical histories by patient: ${patientId}`, error.stack);
      throw error;
    }
  }

  /**
   * Find single medical history by ID
   * @param id Medical history ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Single medical history
   */
  async findOne(id: string, workspaceId: string): Promise<MedicalHistoryResponseDto> {
    this.logger.log(`Finding medical history by ID: ${id}, workspace: ${workspaceId}`);

    try {
      const medicalHistory = await this.medicalHistoryRepository.findOne({
        where: { id, workspaceId, deletedAt: IsNull() },
        relations: ['patient'],
      });

      if (!medicalHistory) {
        this.logger.error(`Medical history not found: ${id}`);
        throw new NotFoundException(`Medical history with ID ${id} not found`);
      }

      // Audit log for VIEW_MEDICAL_HISTORY (non-blocking, HIPAA requirement)
      try {
        await this.auditLogService.log(
          {
            userId: 'system', // Will be replaced by actual userId in controller
            action: 'VIEW_MEDICAL_HISTORY',
            eventType: AuditEventType.READ,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'MedicalHistory',
            resourceId: id,
            patientId: medicalHistory.patientId,
            metadata: {
              condition: medicalHistory.condition,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for medical history view - ID: ${id}`, auditError.stack);
      }

      return MedicalHistoryResponseDto.fromEntity(medicalHistory);
    } catch (error) {
      this.logger.error(`Failed to find medical history by ID: ${id}`, error.stack);
      throw error;
    }
  }

  /**
   * Update a medical history entry
   * @param id Medical history ID
   * @param dto Update data
   * @param userId User ID performing the update
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Updated medical history
   */
  async update(
    id: string,
    dto: UpdateMedicalHistoryDto,
    userId: string,
    workspaceId: string,
  ): Promise<MedicalHistoryResponseDto> {
    this.logger.log(`Updating medical history: ${id}, workspace: ${workspaceId}`);

    try {
      const medicalHistory = await this.medicalHistoryRepository.findOne({
        where: { id, workspaceId, deletedAt: IsNull() },
      });

      if (!medicalHistory) {
        this.logger.error(`Medical history not found: ${id}`);
        throw new NotFoundException(`Medical history with ID ${id} not found`);
      }

      // Update fields
      Object.assign(medicalHistory, dto);
      medicalHistory.userId = userId; // Track who last modified

      const updatedMedicalHistory = await this.medicalHistoryRepository.save(medicalHistory);

      this.logger.log(`Medical history updated successfully - ID: ${id}`);

      // Audit log for UPDATE_MEDICAL_HISTORY (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'UPDATE_MEDICAL_HISTORY',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'MedicalHistory',
            resourceId: id,
            patientId: medicalHistory.patientId,
            metadata: {
              updates: Object.keys(dto),
              condition: updatedMedicalHistory.condition,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for medical history update - ID: ${id}`, auditError.stack);
      }

      return MedicalHistoryResponseDto.fromEntity(updatedMedicalHistory);
    } catch (error) {
      this.logger.error(`Failed to update medical history: ${id}`, error.stack);
      throw error;
    }
  }

  /**
   * Soft delete a medical history entry
   * @param id Medical history ID
   * @param userId User ID performing the deletion
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Void
   */
  async remove(id: string, userId: string, workspaceId: string): Promise<void> {
    this.logger.log(`Deleting medical history: ${id}, workspace: ${workspaceId}`);

    try {
      const medicalHistory = await this.medicalHistoryRepository.findOne({
        where: { id, workspaceId, deletedAt: IsNull() },
      });

      if (!medicalHistory) {
        this.logger.error(`Medical history not found: ${id}`);
        throw new NotFoundException(`Medical history with ID ${id} not found`);
      }

      // Soft delete
      medicalHistory.deletedAt = new Date();
      await this.medicalHistoryRepository.save(medicalHistory);

      this.logger.log(`Medical history deleted successfully - ID: ${id}`);

      // Audit log for DELETE_MEDICAL_HISTORY (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'DELETE_MEDICAL_HISTORY',
            eventType: AuditEventType.DELETE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'MedicalHistory',
            resourceId: id,
            patientId: medicalHistory.patientId,
            metadata: {
              condition: medicalHistory.condition,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for medical history deletion - ID: ${id}`, auditError.stack);
      }
    } catch (error) {
      this.logger.error(`Failed to delete medical history: ${id}`, error.stack);
      throw error;
    }
  }

  /**
   * Find active medical histories (not deleted) with pagination
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Paginated medical histories
   */
  async findActive(
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedMedicalHistoryResponseDto> {
    this.logger.log(`Finding active medical histories - workspace: ${workspaceId}`);

    try {
      const [histories, total] = await this.medicalHistoryRepository.findActive(
        workspaceId,
        page,
        Math.min(limit, 100), // Max 100 per page
      );

      return {
        data: histories.map((history) => MedicalHistoryResponseDto.fromEntity(history)),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to find active medical histories for workspace: ${workspaceId}`, error.stack);
      throw error;
    }
  }

  /**
   * Find chronic conditions for a patient
   * Chronic conditions require ongoing management (diabetes, hypertension, etc.)
   * @param patientId Patient ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Array of chronic medical histories
   */
  async findChronic(patientId: string, workspaceId: string): Promise<MedicalHistoryResponseDto[]> {
    this.logger.log(`Finding chronic conditions for patient: ${patientId}, workspace: ${workspaceId}`);

    try {
      // Validate patient exists
      const patient = await this.patientRepository.findOne({
        where: { id: patientId, workspaceId },
      });

      if (!patient) {
        this.logger.error(`Patient not found: ${patientId}`);
        throw new NotFoundException(`Patient with ID ${patientId} not found`);
      }

      const chronicConditions = await this.medicalHistoryRepository.findChronic(
        patientId,
        workspaceId,
      );

      this.logger.log(`Found ${chronicConditions.length} chronic conditions for patient: ${patientId}`);

      // Audit log for VIEW_MEDICAL_HISTORY (non-blocking, HIPAA requirement)
      try {
        await this.auditLogService.log(
          {
            userId: 'system', // Will be replaced by actual userId in controller
            action: 'VIEW_MEDICAL_HISTORY',
            eventType: AuditEventType.READ,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'MedicalHistory',
            patientId,
            metadata: {
              count: chronicConditions.length,
              type: 'chronic_conditions',
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for chronic conditions view - patient: ${patientId}`, auditError.stack);
      }

      return chronicConditions.map((history) => MedicalHistoryResponseDto.fromEntity(history));
    } catch (error) {
      this.logger.error(`Failed to find chronic conditions for patient: ${patientId}`, error.stack);
      throw error;
    }
  }
}
