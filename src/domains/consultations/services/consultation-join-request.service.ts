import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConsultationRepository } from '../repositories/consultation.repository';
import { ConsultationCollaboratorRepository } from '../repositories/consultation-collaborator.repository';
import { ConsultationJoinRequestRepository } from '../repositories/consultation-join-request.repository';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { AuditEventType, AuditOutcome, RequestStatus } from '../../../common/enums';
import {
  CreateJoinRequestDto,
  JoinRequestQueryDto,
  JoinRequestResponseDto,
  PaginatedResponseDto,
} from '../dto';

/**
 * Service for managing consultation join requests
 * Handles join request lifecycle with business logic and audit logging
 */
@Injectable()
export class ConsultationJoinRequestService {
  constructor(
    private readonly consultationRepository: ConsultationRepository,
    private readonly collaboratorRepository: ConsultationCollaboratorRepository,
    private readonly joinRequestRepository: ConsultationJoinRequestRepository,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext('ConsultationJoinRequestService');
  }

  /**
   * Create join request
   * Auto-approves if isOpenForJoining=true AND requiresJoinApproval=false
   * @param dto Create join request DTO
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns JoinRequestResponseDto
   */
  async createJoinRequest(
    dto: CreateJoinRequestDto,
    workspaceId: string,
  ): Promise<JoinRequestResponseDto> {
    this.logger.log(
      `Creating join request for consultation: ${dto.consultationId}, user: ${dto.requestingUserId}`,
    );

    // Validate consultation exists
    const consultation = await this.consultationRepository.findByIdWithRelations(
      dto.consultationId,
      workspaceId,
    );

    if (!consultation) {
      this.logger.error(`Consultation not found: ${dto.consultationId}`);
      throw new NotFoundException(
        `Consultation with ID ${dto.consultationId} not found`,
      );
    }

    // Check if user is already a collaborator
    const isCollaborator = await this.consultationRepository.isUserCollaborator(
      dto.consultationId,
      dto.requestingUserId,
      workspaceId,
    );

    if (isCollaborator) {
      this.logger.error(
        `User ${dto.requestingUserId} is already a collaborator on consultation: ${dto.consultationId}`,
      );
      throw new ConflictException('User is already a collaborator on this consultation');
    }

    // Check for existing pending request
    const existingRequest = await this.joinRequestRepository.findExistingRequest(
      dto.consultationId,
      dto.requestingUserId,
      workspaceId,
    );

    if (existingRequest) {
      this.logger.error(
        `Duplicate pending request for user ${dto.requestingUserId} on consultation: ${dto.consultationId}`,
      );
      throw new ConflictException('A pending join request already exists for this consultation');
    }

    try {
      // Check auto-approval logic
      const shouldAutoApprove =
        consultation.isOpenForJoining && !consultation.requiresJoinApproval;

      if (shouldAutoApprove) {
        // Auto-approve: create request and add as collaborator in transaction
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
          // Create approved request
          const joinRequest = this.joinRequestRepository.create({
            consultationId: dto.consultationId,
            requestingUserId: dto.requestingUserId,
            role: dto.role,
            status: RequestStatus.APPROVED,
            processedAt: new Date(),
          });

          const savedRequest = await queryRunner.manager.save(joinRequest);

          // Add as collaborator
          const collaborator = this.collaboratorRepository.create({
            consultationId: dto.consultationId,
            userId: dto.requestingUserId,
            role: dto.role,
            isActive: true,
          });

          await queryRunner.manager.save(collaborator);

          await queryRunner.commitTransaction();

          this.logger.log(
            `Join request auto-approved and user added as collaborator - Request: ${savedRequest.id}`,
          );

          // Audit log (non-blocking)
          try {
            await this.auditLogService.log(
              {
                userId: dto.requestingUserId,
                action: 'CREATE_JOIN_REQUEST',
                eventType: AuditEventType.CREATE,
                outcome: AuditOutcome.SUCCESS,
                resourceType: 'ConsultationJoinRequest',
                resourceId: savedRequest.id,
                patientId: consultation.patientId,
                metadata: {
                  autoApproved: true,
                  role: dto.role,
                },
              },
              workspaceId,
            );
          } catch (auditError) {
            this.logger.error(
              `Failed to create audit log for join request creation - ID: ${savedRequest.id}`,
              auditError instanceof Error ? auditError.stack : String(auditError),
            );
          }

          return JoinRequestResponseDto.fromEntity(savedRequest);
        } catch (error) {
          await queryRunner.rollbackTransaction();
          throw error;
        } finally {
          await queryRunner.release();
        }
      } else {
        // Create pending request
        const joinRequest = this.joinRequestRepository.create({
          consultationId: dto.consultationId,
          requestingUserId: dto.requestingUserId,
          role: dto.role,
          status: RequestStatus.PENDING,
        });

        const savedRequest = await this.joinRequestRepository.save(joinRequest);

        this.logger.log(`Join request created - ID: ${savedRequest.id}, status: PENDING`);

        // Audit log (non-blocking)
        try {
          await this.auditLogService.log(
            {
              userId: dto.requestingUserId,
              action: 'CREATE_JOIN_REQUEST',
              eventType: AuditEventType.CREATE,
              outcome: AuditOutcome.SUCCESS,
              resourceType: 'ConsultationJoinRequest',
              resourceId: savedRequest.id,
              patientId: consultation.patientId,
              metadata: {
                role: dto.role,
              },
            },
            workspaceId,
          );
        } catch (auditError) {
          this.logger.error(
            `Failed to create audit log for join request creation - ID: ${savedRequest.id}`,
            auditError instanceof Error ? auditError.stack : String(auditError),
          );
        }

        return JoinRequestResponseDto.fromEntity(savedRequest);
      }
    } catch (error) {
      this.logger.error(
        `Failed to create join request for consultation: ${dto.consultationId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Approve join request
   * Adds user as collaborator with requested role in transaction
   * @param requestId Join request ID
   * @param processedBy User ID processing request
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns JoinRequestResponseDto
   */
  async approveRequest(
    requestId: string,
    processedBy: string,
    workspaceId: string,
  ): Promise<JoinRequestResponseDto> {
    this.logger.log(`Approving join request: ${requestId}`);

    // Find request
    const request = await this.joinRequestRepository.findByIdAndWorkspace(
      requestId,
      workspaceId,
    );

    if (!request) {
      this.logger.error(`Join request not found: ${requestId}`);
      throw new NotFoundException(`Join request with ID ${requestId} not found`);
    }

    // Only PENDING requests can be approved
    if (request.status !== RequestStatus.PENDING) {
      this.logger.error(
        `Cannot approve join request with status: ${request.status}`,
      );
      throw new BadRequestException(
        `Only pending requests can be approved. Current status: ${request.status}`,
      );
    }

    // Validate consultation exists
    const consultation = await this.consultationRepository.findByIdWithRelations(
      request.consultationId,
      workspaceId,
    );

    if (!consultation) {
      this.logger.error(`Consultation not found: ${request.consultationId}`);
      throw new NotFoundException(
        `Consultation with ID ${request.consultationId} not found`,
      );
    }

    // Check if user is owner or WORKSPACE_OWNER collaborator
    const isOwner = consultation.doctorId === processedBy;
    if (!isOwner) {
      this.logger.error(
        `User ${processedBy} not authorized to approve join request`,
      );
      throw new ForbiddenException('Only consultation owner can approve join requests');
    }

    // Transaction: update request and add collaborator
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Update request status
      request.status = RequestStatus.APPROVED;
      request.processedBy = processedBy;
      request.processedAt = new Date();

      const updatedRequest = await queryRunner.manager.save(request);

      // Add as collaborator
      const collaborator = this.collaboratorRepository.create({
        consultationId: request.consultationId,
        userId: request.requestingUserId,
        role: request.role,
        isActive: true,
      });

      await queryRunner.manager.save(collaborator);

      await queryRunner.commitTransaction();

      this.logger.log(
        `Join request approved and user added as collaborator - Request: ${requestId}`,
      );

      // Audit log (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId: processedBy,
            action: 'APPROVE_JOIN_REQUEST',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'ConsultationJoinRequest',
            resourceId: requestId,
            patientId: consultation.patientId,
            metadata: {
              requestingUserId: request.requestingUserId,
              role: request.role,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for join request approval - ID: ${requestId}`,
          auditError instanceof Error ? auditError.stack : String(auditError),
        );
      }

      return JoinRequestResponseDto.fromEntity(updatedRequest);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Failed to approve join request: ${requestId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Reject join request
   * Updates status and sets processedAt
   * @param requestId Join request ID
   * @param processedBy User ID processing request
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns JoinRequestResponseDto
   */
  async rejectRequest(
    requestId: string,
    processedBy: string,
    workspaceId: string,
  ): Promise<JoinRequestResponseDto> {
    this.logger.log(`Rejecting join request: ${requestId}`);

    // Find request
    const request = await this.joinRequestRepository.findByIdAndWorkspace(
      requestId,
      workspaceId,
    );

    if (!request) {
      this.logger.error(`Join request not found: ${requestId}`);
      throw new NotFoundException(`Join request with ID ${requestId} not found`);
    }

    // Only PENDING requests can be rejected
    if (request.status !== RequestStatus.PENDING) {
      this.logger.error(
        `Cannot reject join request with status: ${request.status}`,
      );
      throw new BadRequestException(
        `Only pending requests can be rejected. Current status: ${request.status}`,
      );
    }

    // Validate consultation exists
    const consultation = await this.consultationRepository.findOne({
      where: { id: request.consultationId },
      relations: ['patient'],
    });

    if (!consultation || consultation.patient.workspaceId !== workspaceId) {
      this.logger.error(`Consultation not found: ${request.consultationId}`);
      throw new NotFoundException(
        `Consultation with ID ${request.consultationId} not found`,
      );
    }

    // Check if user is owner
    const isOwner = consultation.doctorId === processedBy;
    if (!isOwner) {
      this.logger.error(
        `User ${processedBy} not authorized to reject join request`,
      );
      throw new ForbiddenException('Only consultation owner can reject join requests');
    }

    try {
      // Update request status
      request.status = RequestStatus.REJECTED;
      request.processedBy = processedBy;
      request.processedAt = new Date();

      const updatedRequest = await this.joinRequestRepository.save(request);

      this.logger.log(`Join request rejected - ID: ${requestId}`);

      // Audit log (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId: processedBy,
            action: 'REJECT_JOIN_REQUEST',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'ConsultationJoinRequest',
            resourceId: requestId,
            patientId: consultation.patientId,
            metadata: {
              requestingUserId: request.requestingUserId,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for join request rejection - ID: ${requestId}`,
          auditError instanceof Error ? auditError.stack : String(auditError),
        );
      }

      return JoinRequestResponseDto.fromEntity(updatedRequest);
    } catch (error) {
      this.logger.error(
        `Failed to reject join request: ${requestId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Cancel join request
   * User can cancel own PENDING requests
   * @param requestId Join request ID
   * @param userId User ID cancelling request
   * @param workspaceId Workspace ID for multi-tenancy
   */
  async cancelRequest(
    requestId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    this.logger.log(`Cancelling join request: ${requestId}`);

    // Find request
    const request = await this.joinRequestRepository.findByIdAndWorkspace(
      requestId,
      workspaceId,
    );

    if (!request) {
      this.logger.error(`Join request not found: ${requestId}`);
      throw new NotFoundException(`Join request with ID ${requestId} not found`);
    }

    // Only requesting user can cancel
    if (request.requestingUserId !== userId) {
      this.logger.error(
        `User ${userId} not authorized to cancel join request: ${requestId}`,
      );
      throw new ForbiddenException('Only the requesting user can cancel their join request');
    }

    // Only PENDING requests can be cancelled
    if (request.status !== RequestStatus.PENDING) {
      this.logger.error(
        `Cannot cancel join request with status: ${request.status}`,
      );
      throw new BadRequestException(
        `Only pending requests can be cancelled. Current status: ${request.status}`,
      );
    }

    try {
      // Update request status
      request.status = RequestStatus.CANCELLED;
      await this.joinRequestRepository.save(request);

      this.logger.log(`Join request cancelled - ID: ${requestId}`);

      // Audit log (non-blocking)
      try {
        const consultation = await this.consultationRepository.findOne({
          where: { id: request.consultationId },
          relations: ['patient'],
        });

        if (consultation) {
          await this.auditLogService.log(
            {
              userId,
              action: 'CANCEL_JOIN_REQUEST',
              eventType: AuditEventType.DELETE,
              outcome: AuditOutcome.SUCCESS,
              resourceType: 'ConsultationJoinRequest',
              resourceId: requestId,
              patientId: consultation.patientId,
            },
            workspaceId,
          );
        }
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for join request cancellation - ID: ${requestId}`,
          auditError instanceof Error ? auditError.stack : String(auditError),
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to cancel join request: ${requestId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Get pending requests for consultation
   * @param consultationId Consultation ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Paginated join request response
   */
  async getPendingRequests(
    consultationId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedResponseDto<JoinRequestResponseDto>> {
    this.logger.log(
      `Getting pending requests for consultation: ${consultationId}, workspace: ${workspaceId}`,
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
      const [requests, total] =
        await this.joinRequestRepository.findPendingRequests(
          consultationId,
          workspaceId,
          page,
          limit,
        );

      return {
        data: requests.map((r) => JoinRequestResponseDto.fromEntity(r)),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to get pending requests for consultation: ${consultationId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Get user's join requests
   * @param userId User ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Paginated join request response
   */
  async getUserRequests(
    userId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedResponseDto<JoinRequestResponseDto>> {
    this.logger.log(
      `Getting join requests for user: ${userId}, workspace: ${workspaceId}`,
    );

    try {
      const [requests, total] = await this.joinRequestRepository.findByUser(
        userId,
        workspaceId,
        page,
        limit,
      );

      return {
        data: requests.map((r) => JoinRequestResponseDto.fromEntity(r)),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to get join requests for user: ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find one join request by ID
   * @param id Join request ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns JoinRequestResponseDto
   */
  async findOne(
    id: string,
    workspaceId: string,
  ): Promise<JoinRequestResponseDto> {
    this.logger.log(`Finding join request by ID: ${id}, workspace: ${workspaceId}`);

    const request = await this.joinRequestRepository.findByIdAndWorkspace(
      id,
      workspaceId,
    );

    if (!request) {
      this.logger.error(`Join request not found: ${id}`);
      throw new NotFoundException(`Join request with ID ${id} not found`);
    }

    return JoinRequestResponseDto.fromEntity(request);
  }
}
