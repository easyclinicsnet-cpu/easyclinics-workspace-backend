import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { PastMedicalHistory } from '../entities/past-medical-history.entity';
import { LoggerService } from '../../../common/logger/logger.service';

/**
 * Repository for PastMedicalHistory entity operations
 * Handles database queries for patient medical conditions
 */
@Injectable()
export class MedicalHistoryRepository extends Repository<PastMedicalHistory> {
  private readonly logger: LoggerService;

  // Chronic conditions that require ongoing management
  private readonly CHRONIC_CONDITIONS = [
    'diabetes',
    'hypertension',
    'asthma',
    'copd',
    'heart disease',
    'chronic kidney disease',
    'epilepsy',
    'chronic pain',
    'arthritis',
    'hypothyroidism',
    'hyperthyroidism',
  ];

  constructor(dataSource: DataSource, logger: LoggerService) {
    super(PastMedicalHistory, dataSource.createEntityManager());
    this.logger = logger;
    this.logger.setContext('MedicalHistoryRepository');
  }

  /**
   * Find medical histories by patient ID with pagination
   * @param patientId Patient ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Array of medical histories and total count
   */
  async findByPatient(
    patientId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[PastMedicalHistory[], number]> {
    try {
      this.logger.log(`Finding medical histories for patient: ${patientId}, workspace: ${workspaceId}`);

      const qb = this.createQueryBuilder('medicalHistory')
        .leftJoinAndSelect('medicalHistory.patient', 'patient')
        .where('medicalHistory.workspaceId = :workspaceId', { workspaceId })
        .andWhere('medicalHistory.patientId = :patientId', { patientId })
        .andWhere('medicalHistory.deletedAt IS NULL')
        .orderBy('medicalHistory.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [histories, total] = await qb.getManyAndCount();

      this.logger.log(`Found ${histories.length} medical histories out of ${total} for patient: ${patientId}`);

      return [histories, total];
    } catch (error) {
      this.logger.error(`Error finding medical histories by patient: ${patientId}`, error.stack);
      throw error;
    }
  }

  /**
   * Find chronic conditions for a patient
   * Chronic conditions are identified by condition name matching known patterns
   * @param patientId Patient ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Array of chronic medical histories
   */
  async findChronic(
    patientId: string,
    workspaceId: string,
  ): Promise<PastMedicalHistory[]> {
    try {
      this.logger.log(`Finding chronic conditions for patient: ${patientId}, workspace: ${workspaceId}`);

      const qb = this.createQueryBuilder('medicalHistory')
        .leftJoinAndSelect('medicalHistory.patient', 'patient')
        .where('medicalHistory.workspaceId = :workspaceId', { workspaceId })
        .andWhere('medicalHistory.patientId = :patientId', { patientId })
        .andWhere('medicalHistory.deletedAt IS NULL');

      // Build OR conditions for chronic conditions
      const conditions = this.CHRONIC_CONDITIONS.map((condition, index) => {
        return `LOWER(medicalHistory.condition) LIKE :condition${index}`;
      });

      if (conditions.length > 0) {
        qb.andWhere(`(${conditions.join(' OR ')})`,
          this.CHRONIC_CONDITIONS.reduce((acc, condition, index) => {
            acc[`condition${index}`] = `%${condition.toLowerCase()}%`;
            return acc;
          }, {} as Record<string, string>)
        );
      }

      qb.orderBy('medicalHistory.createdAt', 'DESC');

      const histories = await qb.getMany();

      this.logger.log(`Found ${histories.length} chronic conditions for patient: ${patientId}`);

      return histories;
    } catch (error) {
      this.logger.error(`Error finding chronic conditions for patient: ${patientId}`, error.stack);
      throw error;
    }
  }

  /**
   * Search medical histories by condition name
   * @param searchTerm Search term
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Array of medical histories and total count
   */
  async searchByCondition(
    searchTerm: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[PastMedicalHistory[], number]> {
    try {
      this.logger.log(`Searching medical histories with term: "${searchTerm}", workspace: ${workspaceId}`);

      const qb = this.createQueryBuilder('medicalHistory')
        .leftJoinAndSelect('medicalHistory.patient', 'patient')
        .where('medicalHistory.workspaceId = :workspaceId', { workspaceId })
        .andWhere(
          '(medicalHistory.condition LIKE :search OR medicalHistory.details LIKE :search)',
          { search: `%${searchTerm}%` },
        )
        .andWhere('medicalHistory.deletedAt IS NULL')
        .orderBy('medicalHistory.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [histories, total] = await qb.getManyAndCount();

      this.logger.log(`Medical history search completed - found ${histories.length} out of ${total} for term: "${searchTerm}"`);

      return [histories, total];
    } catch (error) {
      this.logger.error(`Error searching medical histories with term: "${searchTerm}"`, error.stack);
      throw error;
    }
  }

  /**
   * Find active medical histories (not deleted) with pagination
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Array of medical histories and total count
   */
  async findActive(
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[PastMedicalHistory[], number]> {
    try {
      this.logger.log(`Finding active medical histories - workspace: ${workspaceId}`);

      const qb = this.createQueryBuilder('medicalHistory')
        .leftJoinAndSelect('medicalHistory.patient', 'patient')
        .where('medicalHistory.workspaceId = :workspaceId', { workspaceId })
        .andWhere('medicalHistory.deletedAt IS NULL')
        .orderBy('medicalHistory.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [histories, total] = await qb.getManyAndCount();

      this.logger.log(`Found ${histories.length} active medical histories out of ${total} total for workspace: ${workspaceId}`);

      return [histories, total];
    } catch (error) {
      this.logger.error(`Error finding active medical histories for workspace: ${workspaceId}`, error.stack);
      throw error;
    }
  }
}
