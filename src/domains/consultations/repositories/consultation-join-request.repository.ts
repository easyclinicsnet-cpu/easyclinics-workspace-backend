import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ConsultationJoinRequest } from '../entities/consultation-join-request.entity';
import { LoggerService } from '../../../common/logger/logger.service';
import { JoinRequestQueryDto } from '../dto';
import { RequestStatus } from '../../../common/enums';

/**
 * Repository for ConsultationJoinRequest entity
 * No encryption needed - extends standard Repository
 * Multi-tenancy enforced via Consultation.patient.workspaceId
 */
@Injectable()
export class ConsultationJoinRequestRepository extends Repository<ConsultationJoinRequest> {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    super(ConsultationJoinRequest, dataSource.manager);
    this.logger.setContext('ConsultationJoinRequestRepository');
  }

  /**
   * Find pending join requests for consultation with pagination
   * @param consultationId Consultation ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Tuple of [requests, total count]
   */
  async findPendingRequests(
    consultationId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[ConsultationJoinRequest[], number]> {
    this.logger.debug(`Finding pending requests for consultation: ${consultationId}, workspace: ${workspaceId}`);

    const skip = (page - 1) * limit;

    const [requests, total] = await this.createQueryBuilder('request')
      .innerJoin('request.consultation', 'consultation')
      .innerJoin('consultation.patient', 'patient')
      .where('request.consultationId = :consultationId', { consultationId })
      .andWhere('request.status = :status', { status: RequestStatus.PENDING })
      .andWhere('patient.workspaceId = :workspaceId', { workspaceId })
      .orderBy('request.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return [requests, total];
  }

  /**
   * Find join requests by requesting user with pagination
   * @param userId User ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Tuple of [requests, total count]
   */
  async findByUser(
    userId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[ConsultationJoinRequest[], number]> {
    this.logger.debug(`Finding join requests by user: ${userId}, workspace: ${workspaceId}`);

    const skip = (page - 1) * limit;

    const [requests, total] = await this.createQueryBuilder('request')
      .innerJoin('request.consultation', 'consultation')
      .innerJoin('consultation.patient', 'patient')
      .where('request.requestingUserId = :userId', { userId })
      .andWhere('patient.workspaceId = :workspaceId', { workspaceId })
      .orderBy('request.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return [requests, total];
  }

  /**
   * Find join request by ID and workspace
   * @param id Request ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns ConsultationJoinRequest or null
   */
  async findByIdAndWorkspace(
    id: string,
    workspaceId: string,
  ): Promise<ConsultationJoinRequest | null> {
    this.logger.debug(`Finding join request by ID: ${id}, workspace: ${workspaceId}`);

    const request = await this.createQueryBuilder('request')
      .innerJoin('request.consultation', 'consultation')
      .innerJoin('consultation.patient', 'patient')
      .where('request.id = :id', { id })
      .andWhere('patient.workspaceId = :workspaceId', { workspaceId })
      .getOne();

    return request;
  }

  /**
   * Find existing request for user on consultation
   * Used to check for duplicate requests
   * @param consultationId Consultation ID
   * @param userId User ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns ConsultationJoinRequest or null
   */
  async findExistingRequest(
    consultationId: string,
    userId: string,
    workspaceId: string,
  ): Promise<ConsultationJoinRequest | null> {
    this.logger.debug(`Checking for existing request: consultation ${consultationId}, user ${userId}`);

    const request = await this.createQueryBuilder('request')
      .innerJoin('request.consultation', 'consultation')
      .innerJoin('consultation.patient', 'patient')
      .where('request.consultationId = :consultationId', { consultationId })
      .andWhere('request.requestingUserId = :userId', { userId })
      .andWhere('request.status = :status', { status: RequestStatus.PENDING })
      .andWhere('patient.workspaceId = :workspaceId', { workspaceId })
      .getOne();

    return request;
  }

  /**
   * Find join requests with advanced filters
   * @param query Query DTO with filters
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Tuple of [requests, total count]
   */
  async findWithFilters(
    query: JoinRequestQueryDto,
    workspaceId: string,
  ): Promise<[ConsultationJoinRequest[], number]> {
    this.logger.debug(`Finding join requests with filters, workspace: ${workspaceId}`);

    const skip = ((query.page || 1) - 1) * (query.limit || 10);
    const qb = this.createQueryBuilder('request')
      .innerJoin('request.consultation', 'consultation')
      .innerJoin('consultation.patient', 'patient')
      .where('patient.workspaceId = :workspaceId', { workspaceId });

    // Apply filters
    if (query.consultationId) {
      qb.andWhere('request.consultationId = :consultationId', {
        consultationId: query.consultationId,
      });
    }

    if (query.requestingUserId) {
      qb.andWhere('request.requestingUserId = :requestingUserId', {
        requestingUserId: query.requestingUserId,
      });
    }

    if (query.status) {
      qb.andWhere('request.status = :status', { status: query.status });
    }

    // Apply sorting
    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder || 'DESC';
    qb.orderBy(`request.${sortBy}`, sortOrder);

    // Apply pagination
    qb.skip(skip).take(query.limit || 10);

    const [requests, total] = await qb.getManyAndCount();

    return [requests, total];
  }
}
