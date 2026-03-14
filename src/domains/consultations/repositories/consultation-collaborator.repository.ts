import { Injectable } from '@nestjs/common';
import { DataSource, Repository, IsNull } from 'typeorm';
import { ConsultationCollaborator } from '../entities/consultation-collaborator.entity';
import { LoggerService } from '../../../common/logger/logger.service';
import { CollaboratorQueryDto } from '../dto';

/**
 * Repository for ConsultationCollaborator entity
 * No encryption needed - extends standard Repository
 * Multi-tenancy enforced via Consultation.patient.workspaceId
 */
@Injectable()
export class ConsultationCollaboratorRepository extends Repository<ConsultationCollaborator> {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    super(ConsultationCollaborator, dataSource.manager);
    this.logger.setContext('ConsultationCollaboratorRepository');
  }

  /**
   * Find collaborators by consultation ID with pagination
   * @param consultationId Consultation ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Tuple of [collaborators, total count]
   */
  async findByConsultation(
    consultationId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[ConsultationCollaborator[], number]> {
    this.logger.debug(`Finding collaborators by consultation: ${consultationId}, workspace: ${workspaceId}`);

    const skip = (page - 1) * limit;

    const [collaborators, total] = await this.createQueryBuilder('collaborator')
      .innerJoin('collaborator.consultation', 'consultation')
      .innerJoin('consultation.patient', 'patient')
      .where('collaborator.consultationId = :consultationId', { consultationId })
      .andWhere('patient.workspaceId = :workspaceId', { workspaceId })
      .orderBy('collaborator.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return [collaborators, total];
  }

  /**
   * Find specific collaborator by consultation and user
   * @param consultationId Consultation ID
   * @param userId User ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns ConsultationCollaborator or null
   */
  async findByConsultationAndUser(
    consultationId: string,
    userId: string,
    workspaceId: string,
  ): Promise<ConsultationCollaborator | null> {
    this.logger.debug(`Finding collaborator for consultation: ${consultationId}, user: ${userId}`);

    const collaborator = await this.createQueryBuilder('collaborator')
      .innerJoin('collaborator.consultation', 'consultation')
      .innerJoin('consultation.patient', 'patient')
      .where('collaborator.consultationId = :consultationId', { consultationId })
      .andWhere('collaborator.userId = :userId', { userId })
      .andWhere('patient.workspaceId = :workspaceId', { workspaceId })
      .getOne();

    return collaborator;
  }

  /**
   * Find active collaborators for consultation
   * @param consultationId Consultation ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Array of active collaborators
   */
  async findActiveCollaborators(
    consultationId: string,
    workspaceId: string,
  ): Promise<ConsultationCollaborator[]> {
    this.logger.debug(`Finding active collaborators for consultation: ${consultationId}`);

    const collaborators = await this.createQueryBuilder('collaborator')
      .innerJoin('collaborator.consultation', 'consultation')
      .innerJoin('consultation.patient', 'patient')
      .where('collaborator.consultationId = :consultationId', { consultationId })
      .andWhere('collaborator.isActive = :isActive', { isActive: true })
      .andWhere('collaborator.deletedAt IS NULL')
      .andWhere('patient.workspaceId = :workspaceId', { workspaceId })
      .orderBy('collaborator.createdAt', 'ASC')
      .getMany();

    return collaborators;
  }

  /**
   * Find collaborators with advanced filters
   * @param query Query DTO with filters
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Tuple of [collaborators, total count]
   */
  async findWithFilters(
    query: CollaboratorQueryDto,
    workspaceId: string,
  ): Promise<[ConsultationCollaborator[], number]> {
    this.logger.debug(`Finding collaborators with filters, workspace: ${workspaceId}`);

    const skip = ((query.page || 1) - 1) * (query.limit || 10);
    const qb = this.createQueryBuilder('collaborator')
      .innerJoin('collaborator.consultation', 'consultation')
      .innerJoin('consultation.patient', 'patient')
      .where('patient.workspaceId = :workspaceId', { workspaceId });

    // Apply filters
    if (query.consultationId) {
      qb.andWhere('collaborator.consultationId = :consultationId', {
        consultationId: query.consultationId,
      });
    }

    if (query.role) {
      qb.andWhere('collaborator.role = :role', { role: query.role });
    }

    // Apply sorting
    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder || 'DESC';
    qb.orderBy(`collaborator.${sortBy}`, sortOrder);

    // Apply pagination
    qb.skip(skip).take(query.limit || 10);

    const [collaborators, total] = await qb.getManyAndCount();

    return [collaborators, total];
  }

  /**
   * Remove collaborator (soft delete)
   * @param consultationId Consultation ID
   * @param userId User ID
   * @param deletedBy User ID who performed deletion
   * @param workspaceId Workspace ID for multi-tenancy
   */
  async removeCollaborator(
    consultationId: string,
    userId: string,
    deletedBy: string,
    workspaceId: string,
  ): Promise<void> {
    this.logger.debug(`Removing collaborator: ${userId} from consultation: ${consultationId}`);

    // Verify workspace before deletion
    const collaborator = await this.findByConsultationAndUser(
      consultationId,
      userId,
      workspaceId,
    );

    if (!collaborator) {
      this.logger.warn(`Collaborator not found for removal: ${userId}`);
      return;
    }

    // Soft delete
    await this.createQueryBuilder()
      .update(ConsultationCollaborator)
      .set({
        isActive: false,
        deletedAt: new Date(),
        deletedById: deletedBy,
      })
      .where('id = :id', { id: collaborator.id })
      .execute();

    this.logger.log(`Collaborator removed: ${userId} from consultation: ${consultationId}`);
  }
}
