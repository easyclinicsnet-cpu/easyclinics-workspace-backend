import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DataSource , IsNull } from 'typeorm';
import { PastSurgicalHistory } from '../entities/past-surgical-history.entity';
import { SurgicalHistoryRepository } from '../repositories/surgical-history.repository';
import { PatientRepository } from '../repositories/patient.repository';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { AuditEventType, AuditOutcome } from '../../../common/enums';
import {
  CreateSurgicalHistoryDto,
  UpdateSurgicalHistoryDto,
  SurgicalHistoryQueryDto,
  SurgicalHistoryResponseDto,
  PaginatedSurgicalHistoryResponseDto,
} from '../dto';

/**
 * Service for managing patient surgical history
 * Handles CRUD operations with HIPAA-compliant audit logging
 * Supports CPT and ICD-10-PCS procedure coding systems
 * Tracks complications and pre-operative risk assessment
 */
@Injectable()
export class SurgicalHistoryService {
  constructor(
    private readonly surgicalHistoryRepository: SurgicalHistoryRepository,
    private readonly patientRepository: PatientRepository,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext('SurgicalHistoryService');
  }

  /**
   * Create a new surgical history entry with audit logging
   * @param dto Surgical history data
   * @param userId User ID creating the surgical history
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Created surgical history
   */
  async create(
    dto: CreateSurgicalHistoryDto,
    userId: string,
    workspaceId: string,
  ): Promise<SurgicalHistoryResponseDto> {
    this.logger.log(`Creating surgical history for patient: ${dto.patientId}, workspace: ${workspaceId}`);

    // Validate patient exists
    const patient = await this.patientRepository.findOne({
      where: { id: dto.patientId, workspaceId },
    });

    if (!patient) {
      this.logger.error(`Patient not found: ${dto.patientId}`);
      throw new NotFoundException(`Patient with ID ${dto.patientId} not found`);
    }

    // Validate surgery date (not in future unless scheduled)
    if (dto.date) {
      const surgeryDate = new Date(dto.date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (surgeryDate > today) {
        this.logger.error(`Invalid date: surgery date cannot be in the future - ${dto.date}`);
        throw new BadRequestException(`Invalid date: surgery date cannot be in the future`);
      }
    }

    // Create surgical history entity
    const surgicalHistory = this.surgicalHistoryRepository.create({
      ...dto,
      workspaceId,
      userId,
    });

    try {
      // Save surgical history to database
      const savedSurgicalHistory = await this.surgicalHistoryRepository.save(surgicalHistory);

      this.logger.log(`Surgical history created successfully - ID: ${savedSurgicalHistory.id}, patient: ${dto.patientId}`);

      // Audit log for CREATE_SURGICAL_HISTORY (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'CREATE_SURGICAL_HISTORY',
            eventType: AuditEventType.CREATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'SurgicalHistory',
            resourceId: savedSurgicalHistory.id,
            patientId: dto.patientId,
            metadata: {
              procedure: dto.procedure,
              date: dto.date,
              // Details not logged (PHI - may contain complications)
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for surgical history creation - ID: ${savedSurgicalHistory.id}`, auditError.stack);
      }

      return SurgicalHistoryResponseDto.fromEntity(savedSurgicalHistory);
    } catch (error) {
      this.logger.error(`Failed to create surgical history for patient: ${dto.patientId}`, error.stack);
      throw error;
    }
  }

  /**
   * Find all surgical histories with filters and pagination
   * @param query Query parameters with filters
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Paginated surgical histories
   */
  async findAll(query: SurgicalHistoryQueryDto, workspaceId: string): Promise<PaginatedSurgicalHistoryResponseDto> {
    this.logger.log(`Finding all surgical histories for workspace: ${workspaceId}`);

    try {
      const page = query.page || 1;
      const limit = Math.min(query.limit || 10, 100); // Max 100 per page

      let histories: PastSurgicalHistory[];
      let total: number;

      // Apply filters based on query
      if (query.patientId) {
        [histories, total] = await this.surgicalHistoryRepository.findByPatient(
          query.patientId,
          workspaceId,
          page,
          limit,
        );
      } else if (query.procedure) {
        [histories, total] = await this.surgicalHistoryRepository.searchByProcedure(
          query.procedure,
          workspaceId,
          page,
          limit,
        );
      } else if (query.recentDays) {
        [histories, total] = await this.surgicalHistoryRepository.findRecent(
          workspaceId,
          query.recentDays,
          page,
          limit,
        );
      } else if (query.withComplications) {
        [histories, total] = await this.surgicalHistoryRepository.findWithComplications(
          workspaceId,
          page,
          limit,
        );
      } else {
        [histories, total] = await this.surgicalHistoryRepository.findActive(
          workspaceId,
          page,
          limit,
        );
      }

      return {
        data: histories.map((history) => SurgicalHistoryResponseDto.fromEntity(history)),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to find surgical histories for workspace: ${workspaceId}`, error.stack);
      throw error;
    }
  }

  /**
   * Find surgical histories by patient ID with pagination
   * @param patientId Patient ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Paginated surgical histories
   */
  async findByPatient(
    patientId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedSurgicalHistoryResponseDto> {
    this.logger.log(`Finding surgical histories by patient: ${patientId}, workspace: ${workspaceId}`);

    try {
      // Validate patient exists
      const patient = await this.patientRepository.findOne({
        where: { id: patientId, workspaceId },
      });

      if (!patient) {
        this.logger.error(`Patient not found: ${patientId}`);
        throw new NotFoundException(`Patient with ID ${patientId} not found`);
      }

      const [histories, total] = await this.surgicalHistoryRepository.findByPatient(
        patientId,
        workspaceId,
        page,
        Math.min(limit, 100), // Max 100 per page
      );

      // Audit log for VIEW_SURGICAL_HISTORY (non-blocking, HIPAA requirement)
      try {
        await this.auditLogService.log(
          {
            userId: 'system', // Will be replaced by actual userId in controller
            action: 'VIEW_SURGICAL_HISTORY',
            eventType: AuditEventType.READ,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'SurgicalHistory',
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
        this.logger.error(`Failed to create audit log for surgical history view - patient: ${patientId}`, auditError.stack);
      }

      return {
        data: histories.map((history) => SurgicalHistoryResponseDto.fromEntity(history)),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to find surgical histories by patient: ${patientId}`, error.stack);
      throw error;
    }
  }

  /**
   * Find single surgical history by ID
   * @param id Surgical history ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Single surgical history
   */
  async findOne(id: string, workspaceId: string): Promise<SurgicalHistoryResponseDto> {
    this.logger.log(`Finding surgical history by ID: ${id}, workspace: ${workspaceId}`);

    try {
      const surgicalHistory = await this.surgicalHistoryRepository.findOne({
        where: { id, workspaceId, deletedAt: IsNull() },
        relations: ['patient'],
      });

      if (!surgicalHistory) {
        this.logger.error(`Surgical history not found: ${id}`);
        throw new NotFoundException(`Surgical history with ID ${id} not found`);
      }

      // Audit log for VIEW_SURGICAL_HISTORY (non-blocking, HIPAA requirement)
      try {
        await this.auditLogService.log(
          {
            userId: 'system', // Will be replaced by actual userId in controller
            action: 'VIEW_SURGICAL_HISTORY',
            eventType: AuditEventType.READ,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'SurgicalHistory',
            resourceId: id,
            patientId: surgicalHistory.patientId,
            metadata: {
              procedure: surgicalHistory.procedure,
              date: surgicalHistory.date,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for surgical history view - ID: ${id}`, auditError.stack);
      }

      return SurgicalHistoryResponseDto.fromEntity(surgicalHistory);
    } catch (error) {
      this.logger.error(`Failed to find surgical history by ID: ${id}`, error.stack);
      throw error;
    }
  }

  /**
   * Update a surgical history entry
   * @param id Surgical history ID
   * @param dto Update data
   * @param userId User ID performing the update
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Updated surgical history
   */
  async update(
    id: string,
    dto: UpdateSurgicalHistoryDto,
    userId: string,
    workspaceId: string,
  ): Promise<SurgicalHistoryResponseDto> {
    this.logger.log(`Updating surgical history: ${id}, workspace: ${workspaceId}`);

    try {
      const surgicalHistory = await this.surgicalHistoryRepository.findOne({
        where: { id, workspaceId, deletedAt: IsNull() },
      });

      if (!surgicalHistory) {
        this.logger.error(`Surgical history not found: ${id}`);
        throw new NotFoundException(`Surgical history with ID ${id} not found`);
      }

      // Validate surgery date if being updated (not in future)
      if (dto.date) {
        const surgeryDate = new Date(dto.date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (surgeryDate > today) {
          this.logger.error(`Invalid date: surgery date cannot be in the future - ${dto.date}`);
          throw new BadRequestException(`Invalid date: surgery date cannot be in the future`);
        }
      }

      // Update fields
      Object.assign(surgicalHistory, dto);
      surgicalHistory.userId = userId; // Track who last modified

      const updatedSurgicalHistory = await this.surgicalHistoryRepository.save(surgicalHistory);

      this.logger.log(`Surgical history updated successfully - ID: ${id}`);

      // Audit log for UPDATE_SURGICAL_HISTORY (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'UPDATE_SURGICAL_HISTORY',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'SurgicalHistory',
            resourceId: id,
            patientId: surgicalHistory.patientId,
            metadata: {
              updates: Object.keys(dto),
              procedure: updatedSurgicalHistory.procedure,
              date: updatedSurgicalHistory.date,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for surgical history update - ID: ${id}`, auditError.stack);
      }

      return SurgicalHistoryResponseDto.fromEntity(updatedSurgicalHistory);
    } catch (error) {
      this.logger.error(`Failed to update surgical history: ${id}`, error.stack);
      throw error;
    }
  }

  /**
   * Soft delete a surgical history entry
   * @param id Surgical history ID
   * @param userId User ID performing the deletion
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Void
   */
  async remove(id: string, userId: string, workspaceId: string): Promise<void> {
    this.logger.log(`Deleting surgical history: ${id}, workspace: ${workspaceId}`);

    try {
      const surgicalHistory = await this.surgicalHistoryRepository.findOne({
        where: { id, workspaceId, deletedAt: IsNull() },
      });

      if (!surgicalHistory) {
        this.logger.error(`Surgical history not found: ${id}`);
        throw new NotFoundException(`Surgical history with ID ${id} not found`);
      }

      // Soft delete
      surgicalHistory.deletedAt = new Date();
      await this.surgicalHistoryRepository.save(surgicalHistory);

      this.logger.log(`Surgical history deleted successfully - ID: ${id}`);

      // Audit log for DELETE_SURGICAL_HISTORY (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'DELETE_SURGICAL_HISTORY',
            eventType: AuditEventType.DELETE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'SurgicalHistory',
            resourceId: id,
            patientId: surgicalHistory.patientId,
            metadata: {
              procedure: surgicalHistory.procedure,
              date: surgicalHistory.date,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for surgical history deletion - ID: ${id}`, auditError.stack);
      }
    } catch (error) {
      this.logger.error(`Failed to delete surgical history: ${id}`, error.stack);
      throw error;
    }
  }

  /**
   * Find recent surgeries within specified days
   * @param workspaceId Workspace ID for multi-tenancy
   * @param days Number of days to look back
   * @param page Page number
   * @param limit Items per page
   * @returns Paginated surgical histories
   */
  async findRecent(
    workspaceId: string,
    days: number,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedSurgicalHistoryResponseDto> {
    this.logger.log(`Finding recent surgeries within ${days} days - workspace: ${workspaceId}`);

    if (days <= 0) {
      throw new BadRequestException('Days must be a positive number');
    }

    try {
      const [histories, total] = await this.surgicalHistoryRepository.findRecent(
        workspaceId,
        days,
        page,
        Math.min(limit, 100), // Max 100 per page
      );

      return {
        data: histories.map((history) => SurgicalHistoryResponseDto.fromEntity(history)),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to find recent surgeries within ${days} days`, error.stack);
      throw error;
    }
  }

  /**
   * Find surgeries with complications
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Paginated surgical histories with complications
   */
  async findWithComplications(
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedSurgicalHistoryResponseDto> {
    this.logger.log(`Finding surgeries with complications - workspace: ${workspaceId}`);

    try {
      const [histories, total] = await this.surgicalHistoryRepository.findWithComplications(
        workspaceId,
        page,
        Math.min(limit, 100), // Max 100 per page
      );

      return {
        data: histories.map((history) => SurgicalHistoryResponseDto.fromEntity(history)),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to find surgeries with complications for workspace: ${workspaceId}`, error.stack);
      throw error;
    }
  }
}
