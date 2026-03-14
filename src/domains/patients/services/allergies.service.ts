import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource , IsNull } from 'typeorm';
import { Allergy } from '../entities/allergy.entity';
import { AllergyRepository } from '../repositories/allergy.repository';
import { PatientRepository } from '../repositories/patient.repository';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { AuditEventType, AuditOutcome, Severity } from '../../../common/enums';
import {
  CreateAllergyDto,
  UpdateAllergyDto,
  AllergyQueryDto,
  AllergyResponseDto,
  PaginatedAllergiesResponseDto,
} from '../dto';

/**
 * Service for managing patient allergies
 * Handles CRUD operations with HIPAA-compliant audit logging and multi-tenancy support
 * Supports severity classification and duplicate detection
 */
@Injectable()
export class AllergiesService {
  constructor(
    private readonly allergyRepository: AllergyRepository,
    private readonly patientRepository: PatientRepository,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext('AllergiesService');
  }

  /**
   * Create a new allergy entry with audit logging
   * @param dto Allergy data
   * @param userId User ID creating the allergy
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Created allergy
   */
  async create(
    dto: CreateAllergyDto,
    userId: string,
    workspaceId: string,
  ): Promise<AllergyResponseDto> {
    this.logger.log(`Creating allergy for patient: ${dto.patientId}, workspace: ${workspaceId}`);

    // Validate patient exists
    const patient = await this.patientRepository.findOne({
      where: { id: dto.patientId, workspaceId },
    });

    if (!patient) {
      this.logger.error(`Patient not found: ${dto.patientId}`);
      throw new NotFoundException(`Patient with ID ${dto.patientId} not found`);
    }

    // Check for duplicate allergen
    const existingAllergy = await this.allergyRepository.findDuplicates(
      dto.patientId,
      dto.substance,
      workspaceId,
    );

    if (existingAllergy) {
      this.logger.error(`Duplicate allergy found for patient: ${dto.patientId}, substance: ${dto.substance}`);
      throw new ConflictException(`Duplicate allergy: ${dto.substance} already exists for this patient`);
    }

    // Create allergy entity
    const allergy = this.allergyRepository.create({
      ...dto,
      workspaceId,
      userId,
    });

    try {
      // Save allergy to database
      const savedAllergy = await this.allergyRepository.save(allergy);

      this.logger.log(`Allergy created successfully - ID: ${savedAllergy.id}, patient: ${dto.patientId}`);

      // Audit log for CREATE_ALLERGY (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'CREATE_ALLERGY',
            eventType: AuditEventType.CREATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'Allergy',
            resourceId: savedAllergy.id,
            patientId: dto.patientId,
            metadata: {
              substance: dto.substance,
              severity: dto.severity,
              // Reaction details not logged (PHI)
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for allergy creation - ID: ${savedAllergy.id}`, auditError.stack);
      }

      return AllergyResponseDto.fromEntity(savedAllergy);
    } catch (error) {
      this.logger.error(`Failed to create allergy for patient: ${dto.patientId}`, error.stack);
      throw error;
    }
  }

  /**
   * Find all allergies with filters and pagination
   * @param query Query parameters with filters
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Paginated allergies
   */
  async findAll(query: AllergyQueryDto, workspaceId: string): Promise<PaginatedAllergiesResponseDto> {
    this.logger.log(`Finding all allergies for workspace: ${workspaceId}`);

    try {
      const page = query.page || 1;
      const limit = Math.min(query.limit || 10, 100); // Max 100 per page

      let allergies: Allergy[];
      let total: number;

      // Apply filters based on query
      if (query.patientId) {
        [allergies, total] = await this.allergyRepository.findByPatient(
          query.patientId,
          workspaceId,
          page,
          limit,
        );
      } else if (query.severity) {
        [allergies, total] = await this.allergyRepository.findBySeverity(
          query.severity,
          workspaceId,
          page,
          limit,
        );
      } else if (query.substance) {
        [allergies, total] = await this.allergyRepository.searchBySubstance(
          query.substance,
          workspaceId,
          page,
          limit,
        );
      } else {
        [allergies, total] = await this.allergyRepository.findActive(
          workspaceId,
          page,
          limit,
        );
      }

      return {
        data: allergies.map((allergy) => AllergyResponseDto.fromEntity(allergy)),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to find allergies for workspace: ${workspaceId}`, error.stack);
      throw error;
    }
  }

  /**
   * Find allergies by patient ID with pagination
   * @param patientId Patient ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Paginated allergies
   */
  async findByPatient(
    patientId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedAllergiesResponseDto> {
    this.logger.log(`Finding allergies by patient: ${patientId}, workspace: ${workspaceId}`);

    try {
      // Validate patient exists
      const patient = await this.patientRepository.findOne({
        where: { id: patientId, workspaceId },
      });

      if (!patient) {
        this.logger.error(`Patient not found: ${patientId}`);
        throw new NotFoundException(`Patient with ID ${patientId} not found`);
      }

      const [allergies, total] = await this.allergyRepository.findByPatient(
        patientId,
        workspaceId,
        page,
        Math.min(limit, 100), // Max 100 per page
      );

      // Audit log for VIEW_ALLERGY (non-blocking, HIPAA requirement)
      try {
        await this.auditLogService.log(
          {
            userId: 'system', // Will be replaced by actual userId in controller
            action: 'VIEW_ALLERGY',
            eventType: AuditEventType.READ,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'Allergy',
            patientId,
            metadata: {
              count: allergies.length,
              page,
              limit,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for allergy view - patient: ${patientId}`, auditError.stack);
      }

      return {
        data: allergies.map((allergy) => AllergyResponseDto.fromEntity(allergy)),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to find allergies by patient: ${patientId}`, error.stack);
      throw error;
    }
  }

  /**
   * Find single allergy by ID
   * @param id Allergy ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Single allergy
   */
  async findOne(id: string, workspaceId: string): Promise<AllergyResponseDto> {
    this.logger.log(`Finding allergy by ID: ${id}, workspace: ${workspaceId}`);

    try {
      const allergy = await this.allergyRepository.findOne({
        where: { id, workspaceId, deletedAt: IsNull() },
        relations: ['patient'],
      });

      if (!allergy) {
        this.logger.error(`Allergy not found: ${id}`);
        throw new NotFoundException(`Allergy with ID ${id} not found`);
      }

      // Audit log for VIEW_ALLERGY (non-blocking, HIPAA requirement)
      try {
        await this.auditLogService.log(
          {
            userId: 'system', // Will be replaced by actual userId in controller
            action: 'VIEW_ALLERGY',
            eventType: AuditEventType.READ,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'Allergy',
            resourceId: id,
            patientId: allergy.patientId,
            metadata: {
              substance: allergy.substance,
              severity: allergy.severity,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for allergy view - ID: ${id}`, auditError.stack);
      }

      return AllergyResponseDto.fromEntity(allergy);
    } catch (error) {
      this.logger.error(`Failed to find allergy by ID: ${id}`, error.stack);
      throw error;
    }
  }

  /**
   * Update an allergy entry
   * @param id Allergy ID
   * @param dto Update data
   * @param userId User ID performing the update
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Updated allergy
   */
  async update(
    id: string,
    dto: UpdateAllergyDto,
    userId: string,
    workspaceId: string,
  ): Promise<AllergyResponseDto> {
    this.logger.log(`Updating allergy: ${id}, workspace: ${workspaceId}`);

    try {
      const allergy = await this.allergyRepository.findOne({
        where: { id, workspaceId, deletedAt: IsNull() },
      });

      if (!allergy) {
        this.logger.error(`Allergy not found: ${id}`);
        throw new NotFoundException(`Allergy with ID ${id} not found`);
      }

      // Check for duplicate if substance is being updated
      if (dto.substance && dto.substance !== allergy.substance) {
        const existingAllergy = await this.allergyRepository.findDuplicates(
          allergy.patientId,
          dto.substance,
          workspaceId,
        );

        if (existingAllergy && existingAllergy.id !== id) {
          this.logger.error(`Duplicate allergy found - substance: ${dto.substance}`);
          throw new ConflictException(`Duplicate allergy: ${dto.substance} already exists for this patient`);
        }
      }

      // Update fields
      Object.assign(allergy, dto);
      allergy.userId = userId; // Track who last modified

      const updatedAllergy = await this.allergyRepository.save(allergy);

      this.logger.log(`Allergy updated successfully - ID: ${id}`);

      // Audit log for UPDATE_ALLERGY (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'UPDATE_ALLERGY',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'Allergy',
            resourceId: id,
            patientId: allergy.patientId,
            metadata: {
              updates: Object.keys(dto),
              substance: updatedAllergy.substance,
              severity: updatedAllergy.severity,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for allergy update - ID: ${id}`, auditError.stack);
      }

      return AllergyResponseDto.fromEntity(updatedAllergy);
    } catch (error) {
      this.logger.error(`Failed to update allergy: ${id}`, error.stack);
      throw error;
    }
  }

  /**
   * Soft delete an allergy entry
   * @param id Allergy ID
   * @param userId User ID performing the deletion
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Void
   */
  async remove(id: string, userId: string, workspaceId: string): Promise<void> {
    this.logger.log(`Deleting allergy: ${id}, workspace: ${workspaceId}`);

    try {
      const allergy = await this.allergyRepository.findOne({
        where: { id, workspaceId, deletedAt: IsNull() },
      });

      if (!allergy) {
        this.logger.error(`Allergy not found: ${id}`);
        throw new NotFoundException(`Allergy with ID ${id} not found`);
      }

      // Soft delete
      allergy.deletedAt = new Date();
      await this.allergyRepository.save(allergy);

      this.logger.log(`Allergy deleted successfully - ID: ${id}`);

      // Audit log for DELETE_ALLERGY (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'DELETE_ALLERGY',
            eventType: AuditEventType.DELETE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'Allergy',
            resourceId: id,
            patientId: allergy.patientId,
            metadata: {
              substance: allergy.substance,
              severity: allergy.severity,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for allergy deletion - ID: ${id}`, auditError.stack);
      }
    } catch (error) {
      this.logger.error(`Failed to delete allergy: ${id}`, error.stack);
      throw error;
    }
  }

  /**
   * Find allergies by severity with pagination
   * @param severity Severity level
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Paginated allergies
   */
  async findBySeverity(
    severity: Severity,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedAllergiesResponseDto> {
    this.logger.log(`Finding allergies by severity: ${severity}, workspace: ${workspaceId}`);

    try {
      const [allergies, total] = await this.allergyRepository.findBySeverity(
        severity,
        workspaceId,
        page,
        Math.min(limit, 100), // Max 100 per page
      );

      return {
        data: allergies.map((allergy) => AllergyResponseDto.fromEntity(allergy)),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to find allergies by severity: ${severity}`, error.stack);
      throw error;
    }
  }

  /**
   * Find active allergies (not deleted) with pagination
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Paginated allergies
   */
  async findActive(
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedAllergiesResponseDto> {
    this.logger.log(`Finding active allergies - workspace: ${workspaceId}`);

    try {
      const [allergies, total] = await this.allergyRepository.findActive(
        workspaceId,
        page,
        Math.min(limit, 100), // Max 100 per page
      );

      return {
        data: allergies.map((allergy) => AllergyResponseDto.fromEntity(allergy)),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to find active allergies for workspace: ${workspaceId}`, error.stack);
      throw error;
    }
  }
}
