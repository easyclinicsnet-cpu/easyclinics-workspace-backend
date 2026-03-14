import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { FamilyCondition } from '../entities/family-condition.entity';
import { LoggerService } from '../../../common/logger/logger.service';

/**
 * Repository for FamilyCondition entity operations
 * Handles database queries for patient family medical history
 * Supports HL7 FHIR FamilyMemberHistory resource alignment
 */
@Injectable()
export class FamilyConditionRepository extends Repository<FamilyCondition> {
  private readonly logger: LoggerService;

  constructor(dataSource: DataSource, logger: LoggerService) {
    super(FamilyCondition, dataSource.createEntityManager());
    this.logger = logger;
    this.logger.setContext('FamilyConditionRepository');
  }

  /**
   * Find family conditions by patient ID with pagination
   * @param patientId Patient ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Array of family conditions and total count
   */
  async findByPatient(
    patientId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[FamilyCondition[], number]> {
    try {
      this.logger.log(`Finding family conditions for patient: ${patientId}, workspace: ${workspaceId}`);

      const qb = this.createQueryBuilder('familyCondition')
        .leftJoinAndSelect('familyCondition.patient', 'patient')
        .where('familyCondition.workspaceId = :workspaceId', { workspaceId })
        .andWhere('familyCondition.patientId = :patientId', { patientId })
        .andWhere('familyCondition.deletedAt IS NULL')
        .orderBy('familyCondition.relation', 'ASC')
        .addOrderBy('familyCondition.condition', 'ASC')
        .skip((page - 1) * limit)
        .take(limit);

      const [conditions, total] = await qb.getManyAndCount();

      this.logger.log(`Found ${conditions.length} family conditions out of ${total} for patient: ${patientId}`);

      return [conditions, total];
    } catch (error) {
      this.logger.error(`Error finding family conditions by patient: ${patientId}`, error.stack);
      throw error;
    }
  }

  /**
   * Find family conditions by condition name with pagination
   * @param condition Condition name
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Array of family conditions and total count
   */
  async findByCondition(
    condition: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[FamilyCondition[], number]> {
    try {
      this.logger.log(`Finding family conditions with condition: ${condition}, workspace: ${workspaceId}`);

      const qb = this.createQueryBuilder('familyCondition')
        .leftJoinAndSelect('familyCondition.patient', 'patient')
        .where('familyCondition.workspaceId = :workspaceId', { workspaceId })
        .andWhere('familyCondition.condition = :condition', { condition })
        .andWhere('familyCondition.deletedAt IS NULL')
        .orderBy('familyCondition.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [conditions, total] = await qb.getManyAndCount();

      this.logger.log(`Found ${conditions.length} family conditions with condition ${condition} out of ${total} total`);

      return [conditions, total];
    } catch (error) {
      this.logger.error(`Error finding family conditions by condition: ${condition}`, error.stack);
      throw error;
    }
  }

  /**
   * Find family conditions by relationship to patient with pagination
   * @param relationship Relationship type
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Array of family conditions and total count
   */
  async findByRelationship(
    relationship: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[FamilyCondition[], number]> {
    try {
      this.logger.log(`Finding family conditions with relationship: ${relationship}, workspace: ${workspaceId}`);

      const qb = this.createQueryBuilder('familyCondition')
        .leftJoinAndSelect('familyCondition.patient', 'patient')
        .where('familyCondition.workspaceId = :workspaceId', { workspaceId })
        .andWhere('familyCondition.relation = :relation', { relation: relationship })
        .andWhere('familyCondition.deletedAt IS NULL')
        .orderBy('familyCondition.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [conditions, total] = await qb.getManyAndCount();

      this.logger.log(`Found ${conditions.length} family conditions with relationship ${relationship} out of ${total} total`);

      return [conditions, total];
    } catch (error) {
      this.logger.error(`Error finding family conditions by relationship: ${relationship}`, error.stack);
      throw error;
    }
  }

  /**
   * Search family conditions by condition name (partial match)
   * @param searchTerm Search term
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Array of family conditions and total count
   */
  async searchConditions(
    searchTerm: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[FamilyCondition[], number]> {
    try {
      this.logger.log(`Searching family conditions with term: "${searchTerm}", workspace: ${workspaceId}`);

      const qb = this.createQueryBuilder('familyCondition')
        .leftJoinAndSelect('familyCondition.patient', 'patient')
        .where('familyCondition.workspaceId = :workspaceId', { workspaceId })
        .andWhere('familyCondition.condition LIKE :search', { search: `%${searchTerm}%` })
        .andWhere('familyCondition.deletedAt IS NULL')
        .orderBy('familyCondition.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [conditions, total] = await qb.getManyAndCount();

      this.logger.log(`Search completed - found ${conditions.length} out of ${total} for term: "${searchTerm}"`);

      return [conditions, total];
    } catch (error) {
      this.logger.error(`Error searching family conditions with term: "${searchTerm}"`, error.stack);
      throw error;
    }
  }

  /**
   * Get hereditary conditions for a patient (high-risk conditions only)
   * Used for genetic risk assessment
   * @param patientId Patient ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Array of high-risk hereditary conditions
   */
  async getHereditaryConditions(
    patientId: string,
    workspaceId: string,
  ): Promise<FamilyCondition[]> {
    try {
      this.logger.log(`Getting hereditary conditions for patient: ${patientId}`);

      // High-risk hereditary conditions
      const hereditaryConditions = [
        'Breast Cancer', 'Ovarian Cancer', 'Colon Cancer', 'Prostate Cancer',
        'Heart Disease', 'Stroke', 'Hypertension',
        'Diabetes', 'Type 1 Diabetes', 'Type 2 Diabetes',
        'Sickle Cell Anemia', 'Hemophilia', 'Huntington\'s Disease',
        'Alzheimer\'s Disease', 'Parkinson\'s Disease',
      ];

      const qb = this.createQueryBuilder('familyCondition')
        .leftJoinAndSelect('familyCondition.patient', 'patient')
        .where('familyCondition.workspaceId = :workspaceId', { workspaceId })
        .andWhere('familyCondition.patientId = :patientId', { patientId })
        .andWhere('familyCondition.deletedAt IS NULL');

      // Build OR conditions for each hereditary condition
      const orConditions = hereditaryConditions
        .map((_, index) => `familyCondition.condition LIKE :condition${index}`)
        .join(' OR ');

      if (orConditions) {
        qb.andWhere(`(${orConditions})`,
          hereditaryConditions.reduce((acc, condition, index) => {
            acc[`condition${index}`] = `%${condition}%`;
            return acc;
          }, {} as Record<string, string>)
        );
      }

      const conditions = await qb
        .orderBy('familyCondition.relation', 'ASC')
        .getMany();

      this.logger.log(`Found ${conditions.length} hereditary conditions for patient: ${patientId}`);

      return conditions;
    } catch (error) {
      this.logger.error(`Error getting hereditary conditions for patient: ${patientId}`, error.stack);
      throw error;
    }
  }

  /**
   * Get conditions grouped by generation (first, second, third degree relatives)
   * Used for pattern analysis
   * @param patientId Patient ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Object with conditions grouped by degree
   */
  async getConditionsByGeneration(
    patientId: string,
    workspaceId: string,
  ): Promise<{
    firstDegree: FamilyCondition[];
    secondDegree: FamilyCondition[];
    thirdDegree: FamilyCondition[];
  }> {
    try {
      this.logger.log(`Getting conditions by generation for patient: ${patientId}`);

      // Relationship degree mapping
      const firstDegree = ['Mother', 'Father', 'Child', 'Sibling'];
      const secondDegree = ['Grandparent', 'Grandmother', 'Grandfather', 'Aunt', 'Uncle', 'Half-Sibling', 'Grandchild', 'Niece', 'Nephew'];
      const thirdDegree = ['Cousin', 'Great-Grandparent', 'Great-Aunt', 'Great-Uncle'];

      const allConditions = await this.createQueryBuilder('familyCondition')
        .where('familyCondition.workspaceId = :workspaceId', { workspaceId })
        .andWhere('familyCondition.patientId = :patientId', { patientId })
        .andWhere('familyCondition.deletedAt IS NULL')
        .orderBy('familyCondition.relation', 'ASC')
        .getMany();

      const result = {
        firstDegree: allConditions.filter(c => firstDegree.includes(c.relation)),
        secondDegree: allConditions.filter(c => secondDegree.includes(c.relation)),
        thirdDegree: allConditions.filter(c => thirdDegree.includes(c.relation)),
      };

      this.logger.log(
        `Conditions by generation - 1st: ${result.firstDegree.length}, ` +
        `2nd: ${result.secondDegree.length}, 3rd: ${result.thirdDegree.length}`
      );

      return result;
    } catch (error) {
      this.logger.error(`Error getting conditions by generation for patient: ${patientId}`, error.stack);
      throw error;
    }
  }
}
