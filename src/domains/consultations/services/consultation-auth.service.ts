import { Injectable } from '@nestjs/common';
import { ConsultationRepository } from '../repositories/consultation.repository';
import { LoggerService } from '../../../common/logger/logger.service';
import { CollaborationRole } from '../../../common/enums';

/**
 * Service for consultation authorization
 * Provides helper methods for checking user access and permissions
 */
@Injectable()
export class ConsultationAuthService {
  constructor(
    private readonly consultationRepository: ConsultationRepository,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('ConsultationAuthService');
  }

  /**
   * Check if user is consultation owner (doctor)
   * @param consultationId Consultation ID
   * @param userId User ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns True if user is owner
   */
  async isConsultationOwner(
    consultationId: string,
    userId: string,
    workspaceId: string,
  ): Promise<boolean> {
    this.logger.debug(
      `Checking if user ${userId} is owner of consultation: ${consultationId}`,
    );

    const consultation = await this.consultationRepository.findOne({
      where: { id: consultationId },
      relations: ['patient'],
    });

    if (!consultation || consultation.patient.workspaceId !== workspaceId) {
      return false;
    }

    return consultation.doctorId === userId;
  }

  /**
   * Check if user can access consultation (owner or active collaborator)
   * @param consultationId Consultation ID
   * @param userId User ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns True if user has access
   */
  async canUserAccessConsultation(
    consultationId: string,
    userId: string,
    workspaceId: string,
  ): Promise<boolean> {
    this.logger.debug(
      `Checking if user ${userId} can access consultation: ${consultationId}`,
    );

    // Check if owner
    const isOwner = await this.isConsultationOwner(
      consultationId,
      userId,
      workspaceId,
    );

    if (isOwner) {
      return true;
    }

    // Check if active collaborator
    const isCollaborator = await this.consultationRepository.isUserCollaborator(
      consultationId,
      userId,
      workspaceId,
    );

    return isCollaborator;
  }

  /**
   * Get user's collaboration role on consultation
   * @param consultationId Consultation ID
   * @param userId User ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns CollaborationRole or null if not a collaborator
   */
  async getUserCollaboratorRole(
    consultationId: string,
    userId: string,
    workspaceId: string,
  ): Promise<CollaborationRole | null> {
    this.logger.debug(
      `Getting collaborator role for user ${userId} on consultation: ${consultationId}`,
    );

    const collaborator =
      await this.consultationRepository.getUserCollaboratorInfo(
        consultationId,
        userId,
        workspaceId,
      );

    return collaborator ? collaborator.role : null;
  }

  /**
   * Check if user can modify consultation (owner or WORKSPACE_OWNER collaborator)
   * @param consultationId Consultation ID
   * @param userId User ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns True if user can modify
   */
  async canUserModifyConsultation(
    consultationId: string,
    userId: string,
    workspaceId: string,
  ): Promise<boolean> {
    this.logger.debug(
      `Checking if user ${userId} can modify consultation: ${consultationId}`,
    );

    // Check if owner
    const isOwner = await this.isConsultationOwner(
      consultationId,
      userId,
      workspaceId,
    );

    if (isOwner) {
      return true;
    }

    // Check if WORKSPACE_OWNER collaborator
    const collaborator =
      await this.consultationRepository.getUserCollaboratorInfo(
        consultationId,
        userId,
        workspaceId,
      );

    if (
      collaborator &&
      collaborator.role === CollaborationRole.WORKSPACE_OWNER
    ) {
      return true;
    }

    return false;
  }
}
