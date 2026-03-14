import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ConsultationRepository } from '../repositories/consultation.repository';
import { ConsultationCollaboratorRepository } from '../repositories/consultation-collaborator.repository';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { AuditEventType, AuditOutcome, CollaborationRole } from '../../../common/enums';
import {
  AddCollaboratorDto,
  UpdateCollaboratorRoleDto,
  CollaboratorQueryDto,
  CollaboratorResponseDto,
  PaginatedResponseDto,
} from '../dto';

/**
 * Service for managing consultation collaborators
 * Handles collaborator operations with business logic and audit logging
 */
@Injectable()
export class ConsultationCollaborationService {
  private readonly MAX_COLLABORATORS = 15;

  constructor(
    private readonly consultationRepository: ConsultationRepository,
    private readonly collaboratorRepository: ConsultationCollaboratorRepository,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext('ConsultationCollaborationService');
  }

  /**
   * Add collaborators to consultation (batch)
   * Filters out existing collaborators and assigns special roles
   * @param consultationId Consultation ID
   * @param dto Add collaborator DTO
   * @param userId User ID adding collaborators
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Array of CollaboratorResponseDto
   */
  async addCollaborators(
    consultationId: string,
    dto: AddCollaboratorDto,
    userId: string,
    workspaceId: string,
  ): Promise<CollaboratorResponseDto[]> {
    this.logger.log(
      `Adding ${dto.collaborators.length} collaborators to consultation: ${consultationId}`,
    );

    // Validate consultation exists
    const consultation = await this.consultationRepository.findByIdWithRelations(
      consultationId,
      workspaceId,
    );

    if (!consultation) {
      this.logger.error(`Consultation not found: ${consultationId}`);
      throw new NotFoundException(
        `Consultation with ID ${consultationId} not found`,
      );
    }

    // Check if user is owner or WORKSPACE_OWNER collaborator
    const isOwner = consultation.doctorId === userId;
    const userCollaborator =
      await this.consultationRepository.getUserCollaboratorInfo(
        consultationId,
        userId,
        workspaceId,
      );
    const isWorkspaceOwner =
      userCollaborator &&
      userCollaborator.role === CollaborationRole.WORKSPACE_OWNER;

    if (!isOwner && !isWorkspaceOwner) {
      this.logger.error(
        `User ${userId} not authorized to add collaborators to consultation: ${consultationId}`,
      );
      throw new ForbiddenException(
        'Only consultation owner or workspace owner can add collaborators',
      );
    }

    // Get existing active collaborators
    const existingCollaborators =
      await this.collaboratorRepository.findActiveCollaborators(
        consultationId,
        workspaceId,
      );

    // Check MAX_COLLABORATORS limit
    const newCollaboratorsCount =
      existingCollaborators.length + dto.collaborators.length;
    if (newCollaboratorsCount > this.MAX_COLLABORATORS) {
      this.logger.error(
        `Max collaborators limit exceeded for consultation: ${consultationId}`,
      );
      throw new BadRequestException(
        `Maximum ${this.MAX_COLLABORATORS} collaborators allowed per consultation`,
      );
    }

    // Filter out existing collaborators
    const existingUserIds = new Set(
      existingCollaborators.map((c) => c.userId),
    );
    const newCollaborators = dto.collaborators.filter(
      (c) => !existingUserIds.has(c.userId),
    );

    if (newCollaborators.length === 0) {
      this.logger.warn(`All collaborators already exist for consultation: ${consultationId}`);
      return existingCollaborators.map((c) =>
        CollaboratorResponseDto.fromEntity(c),
      );
    }

    try {
      // Create collaborator entities with role assignment
      const collaboratorEntities = newCollaborators.map((collab) => {
        // Assign special roles based on business logic
        let assignedRole = collab.role;

        // NOTE: ownerId logic would require user entity - using consultation owner check
        if (collab.userId === consultation.doctorId) {
          assignedRole = CollaborationRole.DOCTOR;
        }

        return this.collaboratorRepository.create({
          consultationId,
          userId: collab.userId,
          role: assignedRole,
          isActive: true,
        });
      });

      // Save collaborators
      const savedCollaborators = await this.collaboratorRepository.save(
        collaboratorEntities,
      );

      this.logger.log(
        `Added ${savedCollaborators.length} collaborators to consultation: ${consultationId}`,
      );

      // Audit log for ADD_COLLABORATOR (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'ADD_COLLABORATOR',
            eventType: AuditEventType.CREATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'ConsultationCollaborator',
            resourceId: consultationId,
            patientId: consultation.patientId,
            metadata: {
              collaboratorCount: savedCollaborators.length,
              userIds: savedCollaborators.map((c) => c.userId),
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for collaborator addition - Consultation: ${consultationId}`,
          auditError instanceof Error ? auditError.stack : String(auditError),
        );
      }

      return savedCollaborators.map((c) => CollaboratorResponseDto.fromEntity(c));
    } catch (error) {
      this.logger.error(
        `Failed to add collaborators to consultation: ${consultationId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * List collaborators for consultation
   * @param consultationId Consultation ID
   * @param query Query DTO with filters
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Paginated collaborator response
   */
  async listCollaborators(
    consultationId: string,
    query: CollaboratorQueryDto,
    workspaceId: string,
  ): Promise<PaginatedResponseDto<CollaboratorResponseDto>> {
    this.logger.log(
      `Listing collaborators for consultation: ${consultationId}, workspace: ${workspaceId}`,
    );

    // Validate consultation exists
    const consultation = await this.consultationRepository.findOne({
      where: { id: consultationId },
      relations: ['patient'],
    });

    if (!consultation || consultation.patient.workspaceId !== workspaceId) {
      this.logger.error(`Consultation not found: ${consultationId}`);
      throw new NotFoundException(
        `Consultation with ID ${consultationId} not found`,
      );
    }

    try {
      // Set consultation ID in query
      query.consultationId = consultationId;

      const [collaborators, total] =
        await this.collaboratorRepository.findWithFilters(query, workspaceId);

      return {
        data: collaborators.map((c) => CollaboratorResponseDto.fromEntity(c)),
        meta: {
          total,
          page: query.page || 1,
          limit: query.limit || 10,
          totalPages: Math.ceil(total / (query.limit || 10)),
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to list collaborators for consultation: ${consultationId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Update collaborator role
   * Cannot change own role, only owner can update
   * @param consultationId Consultation ID
   * @param collaboratorId Collaborator ID
   * @param dto Update collaborator role DTO
   * @param userId User ID updating role
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns CollaboratorResponseDto
   */
  async updateCollaboratorRole(
    consultationId: string,
    collaboratorId: string,
    dto: UpdateCollaboratorRoleDto,
    userId: string,
    workspaceId: string,
  ): Promise<CollaboratorResponseDto> {
    this.logger.log(
      `Updating collaborator role: ${collaboratorId}, consultation: ${consultationId}`,
    );

    // Validate consultation exists
    const consultation = await this.consultationRepository.findByIdWithRelations(
      consultationId,
      workspaceId,
    );

    if (!consultation) {
      this.logger.error(`Consultation not found: ${consultationId}`);
      throw new NotFoundException(
        `Consultation with ID ${consultationId} not found`,
      );
    }

    // Find collaborator
    const collaborator = await this.collaboratorRepository.findOne({
      where: { id: collaboratorId, consultationId },
    });

    if (!collaborator) {
      this.logger.error(`Collaborator not found: ${collaboratorId}`);
      throw new NotFoundException(
        `Collaborator with ID ${collaboratorId} not found`,
      );
    }

    // Prevent self-role update
    if (collaborator.userId === userId) {
      this.logger.error(`User ${userId} attempting to update own role`);
      throw new ForbiddenException('Cannot update your own role');
    }

    // Check if user is owner
    if (consultation.doctorId !== userId) {
      this.logger.error(
        `User ${userId} not authorized to update collaborator role`,
      );
      throw new ForbiddenException('Only consultation owner can update collaborator roles');
    }

    try {
      // Store previous role for audit
      const previousRole = collaborator.role;

      // Update role
      collaborator.role = dto.role;
      const updatedCollaborator = await this.collaboratorRepository.save(
        collaborator,
      );

      this.logger.log(`Collaborator role updated - ID: ${collaboratorId}`);

      // Audit log for UPDATE_COLLABORATOR_ROLE (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'UPDATE_COLLABORATOR_ROLE',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'ConsultationCollaborator',
            resourceId: collaboratorId,
            patientId: consultation.patientId,
            previousState: { role: previousRole },
            newState: { role: dto.role },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for collaborator role update - ID: ${collaboratorId}`,
          auditError instanceof Error ? auditError.stack : String(auditError),
        );
      }

      return CollaboratorResponseDto.fromEntity(updatedCollaborator);
    } catch (error) {
      this.logger.error(
        `Failed to update collaborator role: ${collaboratorId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Remove collaborator from consultation
   * Cannot remove self, soft delete with deletedAt
   * @param consultationId Consultation ID
   * @param collaboratorId Collaborator ID
   * @param userId User ID removing collaborator
   * @param workspaceId Workspace ID for multi-tenancy
   */
  async removeCollaborator(
    consultationId: string,
    collaboratorId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    this.logger.log(
      `Removing collaborator: ${collaboratorId}, consultation: ${consultationId}`,
    );

    // Validate consultation exists
    const consultation = await this.consultationRepository.findByIdWithRelations(
      consultationId,
      workspaceId,
    );

    if (!consultation) {
      this.logger.error(`Consultation not found: ${consultationId}`);
      throw new NotFoundException(
        `Consultation with ID ${consultationId} not found`,
      );
    }

    // Find collaborator
    const collaborator = await this.collaboratorRepository.findOne({
      where: { id: collaboratorId, consultationId },
    });

    if (!collaborator) {
      this.logger.error(`Collaborator not found: ${collaboratorId}`);
      throw new NotFoundException(
        `Collaborator with ID ${collaboratorId} not found`,
      );
    }

    // Prevent self-removal
    if (collaborator.userId === userId) {
      this.logger.error(`User ${userId} attempting to remove self`);
      throw new ForbiddenException('Cannot remove yourself as collaborator');
    }

    // Check if user is owner or WORKSPACE_OWNER collaborator
    const isOwner = consultation.doctorId === userId;
    const userCollaborator =
      await this.consultationRepository.getUserCollaboratorInfo(
        consultationId,
        userId,
        workspaceId,
      );
    const isWorkspaceOwner =
      userCollaborator &&
      userCollaborator.role === CollaborationRole.WORKSPACE_OWNER;

    if (!isOwner && !isWorkspaceOwner) {
      this.logger.error(
        `User ${userId} not authorized to remove collaborators`,
      );
      throw new ForbiddenException(
        'Only consultation owner or workspace owner can remove collaborators',
      );
    }

    try {
      // Soft delete via repository method
      await this.collaboratorRepository.removeCollaborator(
        consultationId,
        collaborator.userId,
        userId,
        workspaceId,
      );

      this.logger.log(`Collaborator removed - ID: ${collaboratorId}`);

      // Audit log for REMOVE_COLLABORATOR (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'REMOVE_COLLABORATOR',
            eventType: AuditEventType.DELETE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'ConsultationCollaborator',
            resourceId: collaboratorId,
            patientId: consultation.patientId,
            metadata: {
              removedUserId: collaborator.userId,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for collaborator removal - ID: ${collaboratorId}`,
          auditError instanceof Error ? auditError.stack : String(auditError),
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to remove collaborator: ${collaboratorId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Check if user is collaborator and get role
   * @param consultationId Consultation ID
   * @param userId User ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Object with isCollaborator and role
   */
  async isCollaborator(
    consultationId: string,
    userId: string,
    workspaceId: string,
  ): Promise<{ isCollaborator: boolean; role: CollaborationRole | null }> {
    this.logger.debug(
      `Checking if user ${userId} is collaborator on consultation: ${consultationId}`,
    );

    const collaborator =
      await this.consultationRepository.getUserCollaboratorInfo(
        consultationId,
        userId,
        workspaceId,
      );

    return {
      isCollaborator: !!collaborator,
      role: collaborator ? collaborator.role : null,
    };
  }
}
