import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { SocialHistory } from '../entities/social-history.entity';
import { LoggerService } from '../../../common/logger/logger.service';
import { SmokingStatus, AlcoholUse } from '../../../common/enums';

/**
 * Repository for SocialHistory entity operations
 * Handles database queries for patient social and lifestyle information
 */
@Injectable()
export class SocialHistoryRepository extends Repository<SocialHistory> {
  private readonly logger: LoggerService;

  constructor(dataSource: DataSource, logger: LoggerService) {
    super(SocialHistory, dataSource.createEntityManager());
    this.logger = logger;
    this.logger.setContext('SocialHistoryRepository');
  }

  /**
   * Find the latest social history for a patient
   * @param patientId Patient ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Latest social history or null
   */
  async findLatestByPatient(
    patientId: string,
    workspaceId: string,
  ): Promise<SocialHistory | null> {
    try {
      this.logger.log(`Finding latest social history for patient: ${patientId}, workspace: ${workspaceId}`);

      const socialHistory = await this.createQueryBuilder('socialHistory')
        .leftJoinAndSelect('socialHistory.patient', 'patient')
        .where('socialHistory.workspaceId = :workspaceId', { workspaceId })
        .andWhere('socialHistory.patientId = :patientId', { patientId })
        .andWhere('socialHistory.deletedAt IS NULL')
        .orderBy('socialHistory.createdAt', 'DESC')
        .getOne();

      if (socialHistory) {
        this.logger.log(`Latest social history found with ID: ${socialHistory.id} for patient: ${patientId}`);
      } else {
        this.logger.log(`No social history found for patient: ${patientId}`);
      }

      return socialHistory;
    } catch (error) {
      this.logger.error(`Error finding latest social history for patient: ${patientId}`, error.stack);
      throw error;
    }
  }

  /**
   * Find social histories by smoking status with pagination
   * @param status Smoking status
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Array of social histories and total count
   */
  async findBySmokingStatus(
    status: SmokingStatus,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[SocialHistory[], number]> {
    try {
      this.logger.log(`Finding social histories with smoking status: ${status}, workspace: ${workspaceId}`);

      const qb = this.createQueryBuilder('socialHistory')
        .leftJoinAndSelect('socialHistory.patient', 'patient')
        .where('socialHistory.workspaceId = :workspaceId', { workspaceId })
        .andWhere('socialHistory.smokingStatus = :status', { status })
        .andWhere('socialHistory.deletedAt IS NULL')
        .orderBy('socialHistory.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [histories, total] = await qb.getManyAndCount();

      this.logger.log(`Found ${histories.length} social histories with smoking status ${status} out of ${total} total`);

      return [histories, total];
    } catch (error) {
      this.logger.error(`Error finding social histories by smoking status: ${status}`, error.stack);
      throw error;
    }
  }

  /**
   * Find social histories by alcohol use with pagination
   * @param use Alcohol use
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Array of social histories and total count
   */
  async findByAlcoholUse(
    use: AlcoholUse,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[SocialHistory[], number]> {
    try {
      this.logger.log(`Finding social histories with alcohol use: ${use}, workspace: ${workspaceId}`);

      const qb = this.createQueryBuilder('socialHistory')
        .leftJoinAndSelect('socialHistory.patient', 'patient')
        .where('socialHistory.workspaceId = :workspaceId', { workspaceId })
        .andWhere('socialHistory.alcoholUse = :use', { use })
        .andWhere('socialHistory.deletedAt IS NULL')
        .orderBy('socialHistory.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [histories, total] = await qb.getManyAndCount();

      this.logger.log(`Found ${histories.length} social histories with alcohol use ${use} out of ${total} total`);

      return [histories, total];
    } catch (error) {
      this.logger.error(`Error finding social histories by alcohol use: ${use}`, error.stack);
      throw error;
    }
  }

  /**
   * Find high-risk patients based on social factors
   * High risk defined as: CURRENT smoker OR REGULARLY alcohol use OR CURRENT drug use
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Array of social histories and total count
   */
  async findHighRisk(
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[SocialHistory[], number]> {
    try {
      this.logger.log(`Finding high-risk patients - workspace: ${workspaceId}`);

      const qb = this.createQueryBuilder('socialHistory')
        .leftJoinAndSelect('socialHistory.patient', 'patient')
        .where('socialHistory.workspaceId = :workspaceId', { workspaceId })
        .andWhere('socialHistory.deletedAt IS NULL')
        .andWhere(
          '(socialHistory.smokingStatus = :currentSmoking OR socialHistory.alcoholUse = :regularAlcohol OR socialHistory.drugUse = :currentDrug)',
          {
            currentSmoking: SmokingStatus.CURRENT,
            regularAlcohol: AlcoholUse.REGULARLY,
            currentDrug: 'Current', // DrugUse.CURRENT
          },
        )
        .orderBy('socialHistory.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [histories, total] = await qb.getManyAndCount();

      this.logger.log(`Found ${histories.length} high-risk patients out of ${total} total for workspace: ${workspaceId}`);

      return [histories, total];
    } catch (error) {
      this.logger.error(`Error finding high-risk patients for workspace: ${workspaceId}`, error.stack);
      throw error;
    }
  }

  /**
   * Find all social histories by patient ID with pagination
   * @param patientId Patient ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Array of social histories and total count
   */
  async findByPatient(
    patientId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[SocialHistory[], number]> {
    try {
      this.logger.log(`Finding all social histories for patient: ${patientId}, workspace: ${workspaceId}`);

      const qb = this.createQueryBuilder('socialHistory')
        .leftJoinAndSelect('socialHistory.patient', 'patient')
        .where('socialHistory.workspaceId = :workspaceId', { workspaceId })
        .andWhere('socialHistory.patientId = :patientId', { patientId })
        .andWhere('socialHistory.deletedAt IS NULL')
        .orderBy('socialHistory.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [histories, total] = await qb.getManyAndCount();

      this.logger.log(`Found ${histories.length} social histories out of ${total} for patient: ${patientId}`);

      return [histories, total];
    } catch (error) {
      this.logger.error(`Error finding social histories for patient: ${patientId}`, error.stack);
      throw error;
    }
  }
}
