import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { PastSurgicalHistory } from '../entities/past-surgical-history.entity';
import { LoggerService } from '../../../common/logger/logger.service';

/**
 * Repository for PastSurgicalHistory entity operations
 * Handles database queries for patient surgical procedures
 */
@Injectable()
export class SurgicalHistoryRepository extends Repository<PastSurgicalHistory> {
  private readonly logger: LoggerService;

  constructor(dataSource: DataSource, logger: LoggerService) {
    super(PastSurgicalHistory, dataSource.createEntityManager());
    this.logger = logger;
    this.logger.setContext('SurgicalHistoryRepository');
  }

  /**
   * Find surgical histories by patient ID with pagination
   * @param patientId Patient ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Array of surgical histories and total count
   */
  async findByPatient(
    patientId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[PastSurgicalHistory[], number]> {
    try {
      this.logger.log(`Finding surgical histories for patient: ${patientId}, workspace: ${workspaceId}`);

      const qb = this.createQueryBuilder('surgicalHistory')
        .leftJoinAndSelect('surgicalHistory.patient', 'patient')
        .where('surgicalHistory.workspaceId = :workspaceId', { workspaceId })
        .andWhere('surgicalHistory.patientId = :patientId', { patientId })
        .andWhere('surgicalHistory.deletedAt IS NULL')
        .orderBy('surgicalHistory.date', 'DESC')
        .addOrderBy('surgicalHistory.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [histories, total] = await qb.getManyAndCount();

      this.logger.log(`Found ${histories.length} surgical histories out of ${total} for patient: ${patientId}`);

      return [histories, total];
    } catch (error) {
      this.logger.error(`Error finding surgical histories by patient: ${patientId}`, error.stack);
      throw error;
    }
  }

  /**
   * Find recent surgeries within specified days
   * @param workspaceId Workspace ID for multi-tenancy
   * @param days Number of days to look back
   * @param page Page number
   * @param limit Items per page
   * @returns Array of surgical histories and total count
   */
  async findRecent(
    workspaceId: string,
    days: number,
    page: number = 1,
    limit: number = 10,
  ): Promise<[PastSurgicalHistory[], number]> {
    try {
      this.logger.log(`Finding recent surgeries within ${days} days - workspace: ${workspaceId}`);

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const qb = this.createQueryBuilder('surgicalHistory')
        .leftJoinAndSelect('surgicalHistory.patient', 'patient')
        .where('surgicalHistory.workspaceId = :workspaceId', { workspaceId })
        .andWhere('surgicalHistory.date >= :cutoffDate', { cutoffDate })
        .andWhere('surgicalHistory.deletedAt IS NULL')
        .orderBy('surgicalHistory.date', 'DESC')
        .addOrderBy('surgicalHistory.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [histories, total] = await qb.getManyAndCount();

      this.logger.log(`Found ${histories.length} recent surgeries out of ${total} within ${days} days`);

      return [histories, total];
    } catch (error) {
      this.logger.error(`Error finding recent surgeries within ${days} days`, error.stack);
      throw error;
    }
  }

  /**
   * Find surgeries with complications
   * Identifies surgeries where details field contains complication-related keywords
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Array of surgical histories and total count
   */
  async findWithComplications(
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[PastSurgicalHistory[], number]> {
    try {
      this.logger.log(`Finding surgeries with complications - workspace: ${workspaceId}`);

      const complicationKeywords = [
        'complication',
        'infection',
        'bleeding',
        'hemorrhage',
        'sepsis',
        'failure',
        'adverse',
        'problem',
        're-operation',
        'revision',
      ];

      const qb = this.createQueryBuilder('surgicalHistory')
        .leftJoinAndSelect('surgicalHistory.patient', 'patient')
        .where('surgicalHistory.workspaceId = :workspaceId', { workspaceId })
        .andWhere('surgicalHistory.details IS NOT NULL')
        .andWhere('surgicalHistory.deletedAt IS NULL');

      // Build OR conditions for complication keywords
      const conditions = complicationKeywords.map((keyword, index) => {
        return `LOWER(surgicalHistory.details) LIKE :keyword${index}`;
      });

      if (conditions.length > 0) {
        qb.andWhere(`(${conditions.join(' OR ')})`,
          complicationKeywords.reduce((acc, keyword, index) => {
            acc[`keyword${index}`] = `%${keyword.toLowerCase()}%`;
            return acc;
          }, {} as Record<string, string>)
        );
      }

      qb.orderBy('surgicalHistory.date', 'DESC')
        .addOrderBy('surgicalHistory.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [histories, total] = await qb.getManyAndCount();

      this.logger.log(`Found ${histories.length} surgeries with complications out of ${total} total`);

      return [histories, total];
    } catch (error) {
      this.logger.error(`Error finding surgeries with complications`, error.stack);
      throw error;
    }
  }

  /**
   * Search surgical histories by procedure name
   * @param searchTerm Search term
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Array of surgical histories and total count
   */
  async searchByProcedure(
    searchTerm: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[PastSurgicalHistory[], number]> {
    try {
      this.logger.log(`Searching surgical histories with term: "${searchTerm}", workspace: ${workspaceId}`);

      const qb = this.createQueryBuilder('surgicalHistory')
        .leftJoinAndSelect('surgicalHistory.patient', 'patient')
        .where('surgicalHistory.workspaceId = :workspaceId', { workspaceId })
        .andWhere(
          '(surgicalHistory.procedure LIKE :search OR surgicalHistory.details LIKE :search)',
          { search: `%${searchTerm}%` },
        )
        .andWhere('surgicalHistory.deletedAt IS NULL')
        .orderBy('surgicalHistory.date', 'DESC')
        .addOrderBy('surgicalHistory.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [histories, total] = await qb.getManyAndCount();

      this.logger.log(`Surgical history search completed - found ${histories.length} out of ${total} for term: "${searchTerm}"`);

      return [histories, total];
    } catch (error) {
      this.logger.error(`Error searching surgical histories with term: "${searchTerm}"`, error.stack);
      throw error;
    }
  }

  /**
   * Find active surgical histories (not deleted) with pagination
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Array of surgical histories and total count
   */
  async findActive(
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[PastSurgicalHistory[], number]> {
    try {
      this.logger.log(`Finding active surgical histories - workspace: ${workspaceId}`);

      const qb = this.createQueryBuilder('surgicalHistory')
        .leftJoinAndSelect('surgicalHistory.patient', 'patient')
        .where('surgicalHistory.workspaceId = :workspaceId', { workspaceId })
        .andWhere('surgicalHistory.deletedAt IS NULL')
        .orderBy('surgicalHistory.date', 'DESC')
        .addOrderBy('surgicalHistory.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [histories, total] = await qb.getManyAndCount();

      this.logger.log(`Found ${histories.length} active surgical histories out of ${total} total for workspace: ${workspaceId}`);

      return [histories, total];
    } catch (error) {
      this.logger.error(`Error finding active surgical histories for workspace: ${workspaceId}`, error.stack);
      throw error;
    }
  }
}
