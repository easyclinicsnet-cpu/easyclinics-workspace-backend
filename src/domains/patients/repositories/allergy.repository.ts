import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Allergy } from '../entities/allergy.entity';
import { LoggerService } from '../../../common/logger/logger.service';
import { Severity } from '../../../common/enums';

/**
 * Repository for Allergy entity operations
 * Handles database queries for patient allergies
 */
@Injectable()
export class AllergyRepository extends Repository<Allergy> {
  private readonly logger: LoggerService;

  constructor(dataSource: DataSource, logger: LoggerService) {
    super(Allergy, dataSource.createEntityManager());
    this.logger = logger;
    this.logger.setContext('AllergyRepository');
  }

  /**
   * Find allergies by patient ID with pagination
   * @param patientId Patient ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Array of allergies and total count
   */
  async findByPatient(
    patientId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[Allergy[], number]> {
    try {
      this.logger.log(`Finding allergies for patient: ${patientId}, workspace: ${workspaceId}`);

      const qb = this.createQueryBuilder('allergy')
        .leftJoinAndSelect('allergy.patient', 'patient')
        .where('allergy.workspaceId = :workspaceId', { workspaceId })
        .andWhere('allergy.patientId = :patientId', { patientId })
        .andWhere('allergy.deletedAt IS NULL')
        .orderBy('allergy.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [allergies, total] = await qb.getManyAndCount();

      this.logger.log(`Found ${allergies.length} allergies out of ${total} for patient: ${patientId}`);

      return [allergies, total];
    } catch (error) {
      this.logger.error(`Error finding allergies by patient: ${patientId}`, error.stack);
      throw error;
    }
  }

  /**
   * Find allergies by severity with pagination
   * @param severity Severity level
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Array of allergies and total count
   */
  async findBySeverity(
    severity: Severity,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[Allergy[], number]> {
    try {
      this.logger.log(`Finding allergies with severity: ${severity}, workspace: ${workspaceId}`);

      const qb = this.createQueryBuilder('allergy')
        .leftJoinAndSelect('allergy.patient', 'patient')
        .where('allergy.workspaceId = :workspaceId', { workspaceId })
        .andWhere('allergy.severity = :severity', { severity })
        .andWhere('allergy.deletedAt IS NULL')
        .orderBy('allergy.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [allergies, total] = await qb.getManyAndCount();

      this.logger.log(`Found ${allergies.length} allergies with severity ${severity} out of ${total} total`);

      return [allergies, total];
    } catch (error) {
      this.logger.error(`Error finding allergies by severity: ${severity}`, error.stack);
      throw error;
    }
  }

  /**
   * Check for duplicate allergens for a patient
   * @param patientId Patient ID
   * @param substance Allergen substance
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Existing allergy or null
   */
  async findDuplicates(
    patientId: string,
    substance: string,
    workspaceId: string,
  ): Promise<Allergy | null> {
    try {
      this.logger.log(`Checking for duplicate allergy - patient: ${patientId}, substance: ${substance}`);

      const allergy = await this.createQueryBuilder('allergy')
        .where('allergy.workspaceId = :workspaceId', { workspaceId })
        .andWhere('allergy.patientId = :patientId', { patientId })
        .andWhere('allergy.substance = :substance', { substance })
        .andWhere('allergy.deletedAt IS NULL')
        .getOne();

      if (allergy) {
        this.logger.log(`Duplicate allergy found with ID: ${allergy.id}`);
      } else {
        this.logger.log(`No duplicate allergy found for substance: ${substance}`);
      }

      return allergy;
    } catch (error) {
      this.logger.error(`Error checking duplicate allergy for patient: ${patientId}`, error.stack);
      throw error;
    }
  }

  /**
   * Search allergies by substance name
   * @param searchTerm Search term
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Array of allergies and total count
   */
  async searchBySubstance(
    searchTerm: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[Allergy[], number]> {
    try {
      this.logger.log(`Searching allergies with term: "${searchTerm}", workspace: ${workspaceId}`);

      const qb = this.createQueryBuilder('allergy')
        .leftJoinAndSelect('allergy.patient', 'patient')
        .where('allergy.workspaceId = :workspaceId', { workspaceId })
        .andWhere('allergy.substance LIKE :search', { search: `%${searchTerm}%` })
        .andWhere('allergy.deletedAt IS NULL')
        .orderBy('allergy.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [allergies, total] = await qb.getManyAndCount();

      this.logger.log(`Allergy search completed - found ${allergies.length} out of ${total} for term: "${searchTerm}"`);

      return [allergies, total];
    } catch (error) {
      this.logger.error(`Error searching allergies with term: "${searchTerm}"`, error.stack);
      throw error;
    }
  }

  /**
   * Find active allergies (not deleted) with pagination
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Array of allergies and total count
   */
  async findActive(
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[Allergy[], number]> {
    try {
      this.logger.log(`Finding active allergies - workspace: ${workspaceId}`);

      const qb = this.createQueryBuilder('allergy')
        .leftJoinAndSelect('allergy.patient', 'patient')
        .where('allergy.workspaceId = :workspaceId', { workspaceId })
        .andWhere('allergy.deletedAt IS NULL')
        .orderBy('allergy.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [allergies, total] = await qb.getManyAndCount();

      this.logger.log(`Found ${allergies.length} active allergies out of ${total} total for workspace: ${workspaceId}`);

      return [allergies, total];
    } catch (error) {
      this.logger.error(`Error finding active allergies for workspace: ${workspaceId}`, error.stack);
      throw error;
    }
  }
}
