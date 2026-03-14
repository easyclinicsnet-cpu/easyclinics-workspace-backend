import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DataSource , IsNull } from 'typeorm';
import { SocialHistory } from '../entities/social-history.entity';
import { SocialHistoryRepository } from '../repositories/social-history.repository';
import { PatientRepository } from '../repositories/patient.repository';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { AuditEventType, AuditOutcome, SmokingStatus, AlcoholUse } from '../../../common/enums';
import {
  CreateSocialHistoryDto,
  UpdateSocialHistoryDto,
  SocialHistoryQueryDto,
  SocialHistoryResponseDto,
  PaginatedSocialHistoryResponseDto,
} from '../dto';

/**
 * Service for managing patient social history
 * Handles CRUD operations with HIPAA-compliant audit logging
 * Supports risk assessment based on smoking, alcohol, and drug use
 * Maintains one active social history per patient
 */
@Injectable()
export class SocialHistoryService {
  constructor(
    private readonly socialHistoryRepository: SocialHistoryRepository,
    private readonly patientRepository: PatientRepository,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext('SocialHistoryService');
  }

  /**
   * Create a new social history entry with audit logging
   * Deactivates previous social history for the patient (one active record per patient)
   * @param dto Social history data
   * @param userId User ID creating the social history
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Created social history
   */
  async create(
    dto: CreateSocialHistoryDto,
    userId: string,
    workspaceId: string,
  ): Promise<SocialHistoryResponseDto> {
    this.logger.log(`Creating social history for patient: ${dto.patientId}, workspace: ${workspaceId}`);

    // Validate patient exists
    const patient = await this.patientRepository.findOne({
      where: { id: dto.patientId, workspaceId },
    });

    if (!patient) {
      this.logger.error(`Patient not found: ${dto.patientId}`);
      throw new NotFoundException(`Patient with ID ${dto.patientId} not found`);
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Soft delete previous social history for the patient (maintain one active record)
      const existingHistory = await this.socialHistoryRepository.findLatestByPatient(
        dto.patientId,
        workspaceId,
      );

      if (existingHistory) {
        existingHistory.deletedAt = new Date();
        await queryRunner.manager.save(existingHistory);
        this.logger.log(`Deactivated previous social history - ID: ${existingHistory.id}`);
      }

      // Create new social history entity
      const socialHistory = this.socialHistoryRepository.create({
        ...dto,
        workspaceId,
        userId,
      });

      const savedSocialHistory = await queryRunner.manager.save(socialHistory);

      await queryRunner.commitTransaction();

      this.logger.log(`Social history created successfully - ID: ${savedSocialHistory.id}, patient: ${dto.patientId}`);

      // Audit log for CREATE_SOCIAL_HISTORY (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'CREATE_SOCIAL_HISTORY',
            eventType: AuditEventType.CREATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'SocialHistory',
            resourceId: savedSocialHistory.id,
            patientId: dto.patientId,
            metadata: {
              smokingStatus: dto.smokingStatus,
              alcoholUse: dto.alcoholUse,
              drugUse: dto.drugUse,
              hasOccupation: !!dto.occupation,
              // Notes not logged (PHI)
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for social history creation - ID: ${savedSocialHistory.id}`, auditError.stack);
      }

      return SocialHistoryResponseDto.fromEntity(savedSocialHistory);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Failed to create social history for patient: ${dto.patientId}`, error.stack);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Find the latest social history for a patient
   * @param patientId Patient ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Latest social history
   */
  async findByPatient(patientId: string, workspaceId: string): Promise<SocialHistoryResponseDto> {
    this.logger.log(`Finding social history for patient: ${patientId}, workspace: ${workspaceId}`);

    try {
      // Validate patient exists
      const patient = await this.patientRepository.findOne({
        where: { id: patientId, workspaceId },
      });

      if (!patient) {
        this.logger.error(`Patient not found: ${patientId}`);
        throw new NotFoundException(`Patient with ID ${patientId} not found`);
      }

      const socialHistory = await this.socialHistoryRepository.findLatestByPatient(
        patientId,
        workspaceId,
      );

      if (!socialHistory) {
        this.logger.error(`Social history not found for patient: ${patientId}`);
        throw new NotFoundException(`Social history not found for patient ${patientId}`);
      }

      // Audit log for VIEW_SOCIAL_HISTORY (non-blocking, HIPAA requirement)
      try {
        await this.auditLogService.log(
          {
            userId: 'system', // Will be replaced by actual userId in controller
            action: 'VIEW_SOCIAL_HISTORY',
            eventType: AuditEventType.READ,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'SocialHistory',
            resourceId: socialHistory.id,
            patientId,
            metadata: {
              smokingStatus: socialHistory.smokingStatus,
              alcoholUse: socialHistory.alcoholUse,
              drugUse: socialHistory.drugUse,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for social history view - patient: ${patientId}`, auditError.stack);
      }

      return SocialHistoryResponseDto.fromEntity(socialHistory);
    } catch (error) {
      this.logger.error(`Failed to find social history for patient: ${patientId}`, error.stack);
      throw error;
    }
  }

  /**
   * Find single social history by ID
   * @param id Social history ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Single social history
   */
  async findOne(id: string, workspaceId: string): Promise<SocialHistoryResponseDto> {
    this.logger.log(`Finding social history by ID: ${id}, workspace: ${workspaceId}`);

    try {
      const socialHistory = await this.socialHistoryRepository.findOne({
        where: { id, workspaceId, deletedAt: IsNull() },
        relations: ['patient'],
      });

      if (!socialHistory) {
        this.logger.error(`Social history not found: ${id}`);
        throw new NotFoundException(`Social history with ID ${id} not found`);
      }

      // Audit log for VIEW_SOCIAL_HISTORY (non-blocking, HIPAA requirement)
      try {
        await this.auditLogService.log(
          {
            userId: 'system', // Will be replaced by actual userId in controller
            action: 'VIEW_SOCIAL_HISTORY',
            eventType: AuditEventType.READ,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'SocialHistory',
            resourceId: id,
            patientId: socialHistory.patientId,
            metadata: {
              smokingStatus: socialHistory.smokingStatus,
              alcoholUse: socialHistory.alcoholUse,
              drugUse: socialHistory.drugUse,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for social history view - ID: ${id}`, auditError.stack);
      }

      return SocialHistoryResponseDto.fromEntity(socialHistory);
    } catch (error) {
      this.logger.error(`Failed to find social history by ID: ${id}`, error.stack);
      throw error;
    }
  }

  /**
   * Update a social history entry
   * @param id Social history ID
   * @param dto Update data
   * @param userId User ID performing the update
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Updated social history
   */
  async update(
    id: string,
    dto: UpdateSocialHistoryDto,
    userId: string,
    workspaceId: string,
  ): Promise<SocialHistoryResponseDto> {
    this.logger.log(`Updating social history: ${id}, workspace: ${workspaceId}`);

    try {
      const socialHistory = await this.socialHistoryRepository.findOne({
        where: { id, workspaceId, deletedAt: IsNull() },
      });

      if (!socialHistory) {
        this.logger.error(`Social history not found: ${id}`);
        throw new NotFoundException(`Social history with ID ${id} not found`);
      }

      // Update fields
      Object.assign(socialHistory, dto);
      socialHistory.userId = userId; // Track who last modified

      const updatedSocialHistory = await this.socialHistoryRepository.save(socialHistory);

      this.logger.log(`Social history updated successfully - ID: ${id}`);

      // Audit log for UPDATE_SOCIAL_HISTORY (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'UPDATE_SOCIAL_HISTORY',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'SocialHistory',
            resourceId: id,
            patientId: socialHistory.patientId,
            metadata: {
              updates: Object.keys(dto),
              smokingStatus: updatedSocialHistory.smokingStatus,
              alcoholUse: updatedSocialHistory.alcoholUse,
              drugUse: updatedSocialHistory.drugUse,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for social history update - ID: ${id}`, auditError.stack);
      }

      return SocialHistoryResponseDto.fromEntity(updatedSocialHistory);
    } catch (error) {
      this.logger.error(`Failed to update social history: ${id}`, error.stack);
      throw error;
    }
  }

  /**
   * Soft delete a social history entry
   * @param id Social history ID
   * @param userId User ID performing the deletion
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Void
   */
  async remove(id: string, userId: string, workspaceId: string): Promise<void> {
    this.logger.log(`Deleting social history: ${id}, workspace: ${workspaceId}`);

    try {
      const socialHistory = await this.socialHistoryRepository.findOne({
        where: { id, workspaceId, deletedAt: IsNull() },
      });

      if (!socialHistory) {
        this.logger.error(`Social history not found: ${id}`);
        throw new NotFoundException(`Social history with ID ${id} not found`);
      }

      // Soft delete
      socialHistory.deletedAt = new Date();
      await this.socialHistoryRepository.save(socialHistory);

      this.logger.log(`Social history deleted successfully - ID: ${id}`);

      // Audit log for DELETE_SOCIAL_HISTORY (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'DELETE_SOCIAL_HISTORY',
            eventType: AuditEventType.DELETE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'SocialHistory',
            resourceId: id,
            patientId: socialHistory.patientId,
            metadata: {
              smokingStatus: socialHistory.smokingStatus,
              alcoholUse: socialHistory.alcoholUse,
              drugUse: socialHistory.drugUse,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for social history deletion - ID: ${id}`, auditError.stack);
      }
    } catch (error) {
      this.logger.error(`Failed to delete social history: ${id}`, error.stack);
      throw error;
    }
  }

  /**
   * Find social histories by smoking status with pagination
   * @param status Smoking status
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Paginated social histories
   */
  async findBySmokingStatus(
    status: SmokingStatus,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedSocialHistoryResponseDto> {
    this.logger.log(`Finding social histories by smoking status: ${status}, workspace: ${workspaceId}`);

    try {
      const [histories, total] = await this.socialHistoryRepository.findBySmokingStatus(
        status,
        workspaceId,
        page,
        Math.min(limit, 100), // Max 100 per page
      );

      return {
        data: histories.map((history) => SocialHistoryResponseDto.fromEntity(history)),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to find social histories by smoking status: ${status}`, error.stack);
      throw error;
    }
  }

  /**
   * Find social histories by alcohol use with pagination
   * @param use Alcohol use
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Paginated social histories
   */
  async findByAlcoholUse(
    use: AlcoholUse,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedSocialHistoryResponseDto> {
    this.logger.log(`Finding social histories by alcohol use: ${use}, workspace: ${workspaceId}`);

    try {
      const [histories, total] = await this.socialHistoryRepository.findByAlcoholUse(
        use,
        workspaceId,
        page,
        Math.min(limit, 100), // Max 100 per page
      );

      return {
        data: histories.map((history) => SocialHistoryResponseDto.fromEntity(history)),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to find social histories by alcohol use: ${use}`, error.stack);
      throw error;
    }
  }

  /**
   * Find high-risk patients based on social factors
   * High risk: CURRENT smoker OR REGULARLY alcohol use OR CURRENT drug use
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Paginated social histories
   */
  async findRiskPatients(
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedSocialHistoryResponseDto> {
    this.logger.log(`Finding high-risk patients - workspace: ${workspaceId}`);

    try {
      const [histories, total] = await this.socialHistoryRepository.findHighRisk(
        workspaceId,
        page,
        Math.min(limit, 100), // Max 100 per page
      );

      return {
        data: histories.map((history) => SocialHistoryResponseDto.fromEntity(history)),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to find high-risk patients for workspace: ${workspaceId}`, error.stack);
      throw error;
    }
  }
}
