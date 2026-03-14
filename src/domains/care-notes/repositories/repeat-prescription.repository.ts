import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere, LessThanOrEqual } from 'typeorm';
import { RepeatPrescription } from '../entities/repeat-prescription.entity';
import { EncryptedRepository } from '../../../common/database/repositories/encrypted-repository.base';
import { Aes256Service } from '../../../common/security/encryption/aes-256.service';
import { LoggerService } from '../../../common/logger/logger.service';
import { PrescriptionStatus } from '../../../common/enums';
import { RepeatPrescriptionQueryDto } from '../dto/repeat-prescription';

/**
 * Repository for RepeatPrescription entity operations
 * Extends EncryptedRepository for automatic encryption/decryption of sensitive fields
 */
@Injectable()
export class RepeatPrescriptionRepository extends EncryptedRepository<RepeatPrescription> {
  constructor(
    dataSource: DataSource,
    aesService: Aes256Service,
    logger: LoggerService,
  ) {
    super(RepeatPrescription, dataSource, aesService, logger);
    this.logger.setContext('RepeatPrescriptionRepository');
  }

  /**
   * Define searchable encrypted fields for fuzzy search
   */
  protected getSearchableEncryptedFields(): string[] {
    return ['medicine', 'dose', 'route', 'frequency', 'clinicalIndication'];
  }

  /**
   * Define base filters for search queries
   */
  protected getSearchFilters(): Partial<FindOptionsWhere<RepeatPrescription>> {
    return { isActive: true };
  }

  /**
   * Find repeat prescriptions by patient ID with pagination
   * Uses workspaceId from Patient relationship
   */
  async findByPatient(
    patientId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[RepeatPrescription[], number]> {
    try {
      this.logger.log(
        `Finding repeat prescriptions for patient: ${patientId}, workspace: ${workspaceId}`,
      );

      const qb = this.createQueryBuilder('repeatPrescription')
        .innerJoin('patients', 'patient', 'patient.id = repeatPrescription.patientId')
        .where('patient.workspaceId = :workspaceId', { workspaceId })
        .andWhere('repeatPrescription.patientId = :patientId', { patientId })
        .andWhere('repeatPrescription.deletedAt IS NULL')
        .orderBy('repeatPrescription.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [repeatPrescriptions, total] = await qb.getManyAndCount();

      // Decrypt repeat prescriptions
      await Promise.all(
        repeatPrescriptions.map((rp) => this.decryptEntityFields(rp)),
      );

      this.logger.log(
        `Found ${repeatPrescriptions.length} repeat prescriptions out of ${total} for patient: ${patientId}`,
      );

      return [repeatPrescriptions, total];
    } catch (error) {
      this.logger.error(
        `Error finding repeat prescriptions by patient: ${patientId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find repeat prescriptions by doctor ID with pagination
   * Uses workspaceId from Patient relationship
   */
  async findByDoctor(
    doctorId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[RepeatPrescription[], number]> {
    try {
      this.logger.log(
        `Finding repeat prescriptions for doctor: ${doctorId}, workspace: ${workspaceId}`,
      );

      const qb = this.createQueryBuilder('repeatPrescription')
        .innerJoin('patients', 'patient', 'patient.id = repeatPrescription.patientId')
        .where('patient.workspaceId = :workspaceId', { workspaceId })
        .andWhere('repeatPrescription.doctorId = :doctorId', { doctorId })
        .andWhere('repeatPrescription.deletedAt IS NULL')
        .orderBy('repeatPrescription.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [repeatPrescriptions, total] = await qb.getManyAndCount();

      // Decrypt repeat prescriptions
      await Promise.all(
        repeatPrescriptions.map((rp) => this.decryptEntityFields(rp)),
      );

      this.logger.log(
        `Found ${repeatPrescriptions.length} repeat prescriptions out of ${total} for doctor: ${doctorId}`,
      );

      return [repeatPrescriptions, total];
    } catch (error) {
      this.logger.error(
        `Error finding repeat prescriptions by doctor: ${doctorId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find repeat prescriptions by status with pagination
   * Uses workspaceId from Patient relationship
   */
  async findByStatus(
    status: PrescriptionStatus,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[RepeatPrescription[], number]> {
    try {
      this.logger.log(
        `Finding repeat prescriptions with status: ${status}, workspace: ${workspaceId}`,
      );

      const qb = this.createQueryBuilder('repeatPrescription')
        .innerJoin('patients', 'patient', 'patient.id = repeatPrescription.patientId')
        .where('patient.workspaceId = :workspaceId', { workspaceId })
        .andWhere('repeatPrescription.status = :status', { status })
        .andWhere('repeatPrescription.deletedAt IS NULL')
        .orderBy('repeatPrescription.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [repeatPrescriptions, total] = await qb.getManyAndCount();

      // Decrypt repeat prescriptions
      await Promise.all(
        repeatPrescriptions.map((rp) => this.decryptEntityFields(rp)),
      );

      this.logger.log(
        `Found ${repeatPrescriptions.length} repeat prescriptions with status ${status} out of ${total} total`,
      );

      return [repeatPrescriptions, total];
    } catch (error) {
      this.logger.error(
        `Error finding repeat prescriptions by status: ${status}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find repeat prescriptions due for refill
   * Uses workspaceId from Patient relationship
   */
  async findDueForRefill(
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[RepeatPrescription[], number]> {
    try {
      this.logger.log(
        `Finding repeat prescriptions due for refill, workspace: ${workspaceId}`,
      );

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const qb = this.createQueryBuilder('repeatPrescription')
        .innerJoin('patients', 'patient', 'patient.id = repeatPrescription.patientId')
        .where('patient.workspaceId = :workspaceId', { workspaceId })
        .andWhere('repeatPrescription.status = :status', {
          status: PrescriptionStatus.ACTIVE,
        })
        .andWhere('repeatPrescription.nextDueDate <= :today', { today })
        .andWhere('repeatPrescription.deletedAt IS NULL')
        .orderBy('repeatPrescription.nextDueDate', 'ASC')
        .skip((page - 1) * limit)
        .take(limit);

      const [repeatPrescriptions, total] = await qb.getManyAndCount();

      // Decrypt repeat prescriptions
      await Promise.all(
        repeatPrescriptions.map((rp) => this.decryptEntityFields(rp)),
      );

      this.logger.log(
        `Found ${repeatPrescriptions.length} repeat prescriptions due for refill out of ${total} total`,
      );

      return [repeatPrescriptions, total];
    } catch (error) {
      this.logger.error(
        'Error finding repeat prescriptions due for refill',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find repeat prescriptions requiring review
   * Uses workspaceId from Patient relationship
   */
  async findRequiringReview(
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[RepeatPrescription[], number]> {
    try {
      this.logger.log(
        `Finding repeat prescriptions requiring review, workspace: ${workspaceId}`,
      );

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const qb = this.createQueryBuilder('repeatPrescription')
        .innerJoin('patients', 'patient', 'patient.id = repeatPrescription.patientId')
        .where('patient.workspaceId = :workspaceId', { workspaceId })
        .andWhere('repeatPrescription.requiresReview = :requiresReview', {
          requiresReview: true,
        })
        .andWhere('repeatPrescription.reviewDate <= :today', { today })
        .andWhere('repeatPrescription.deletedAt IS NULL')
        .orderBy('repeatPrescription.reviewDate', 'ASC')
        .skip((page - 1) * limit)
        .take(limit);

      const [repeatPrescriptions, total] = await qb.getManyAndCount();

      // Decrypt repeat prescriptions
      await Promise.all(
        repeatPrescriptions.map((rp) => this.decryptEntityFields(rp)),
      );

      this.logger.log(
        `Found ${repeatPrescriptions.length} repeat prescriptions requiring review out of ${total} total`,
      );

      return [repeatPrescriptions, total];
    } catch (error) {
      this.logger.error(
        'Error finding repeat prescriptions requiring review',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find repeat prescriptions expiring within specified days
   * Uses workspaceId from Patient relationship
   */
  async findExpiring(
    workspaceId: string,
    days: number,
    page: number = 1,
    limit: number = 10,
  ): Promise<[RepeatPrescription[], number]> {
    try {
      this.logger.log(
        `Finding repeat prescriptions expiring within ${days} days, workspace: ${workspaceId}`,
      );

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const futureDate = new Date(today);
      futureDate.setDate(futureDate.getDate() + days);

      const qb = this.createQueryBuilder('repeatPrescription')
        .innerJoin('patients', 'patient', 'patient.id = repeatPrescription.patientId')
        .where('patient.workspaceId = :workspaceId', { workspaceId })
        .andWhere('repeatPrescription.endDate IS NOT NULL')
        .andWhere('repeatPrescription.endDate >= :today', { today })
        .andWhere('repeatPrescription.endDate <= :futureDate', { futureDate })
        .andWhere('repeatPrescription.status = :status', {
          status: PrescriptionStatus.ACTIVE,
        })
        .andWhere('repeatPrescription.deletedAt IS NULL')
        .orderBy('repeatPrescription.endDate', 'ASC')
        .skip((page - 1) * limit)
        .take(limit);

      const [repeatPrescriptions, total] = await qb.getManyAndCount();

      // Decrypt repeat prescriptions
      await Promise.all(
        repeatPrescriptions.map((rp) => this.decryptEntityFields(rp)),
      );

      this.logger.log(
        `Found ${repeatPrescriptions.length} repeat prescriptions expiring within ${days} days out of ${total} total`,
      );

      return [repeatPrescriptions, total];
    } catch (error) {
      this.logger.error(
        `Error finding repeat prescriptions expiring within ${days} days`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find repeat prescriptions with filters
   * Supports filtering by patient, doctor, status, isDue, requiresReview
   */
  async findWithFilters(
    query: RepeatPrescriptionQueryDto,
    workspaceId: string,
  ): Promise<[RepeatPrescription[], number]> {
    try {
      this.logger.log(
        `Finding repeat prescriptions with filters, workspace: ${workspaceId}`,
      );

      const page = query.page || 1;
      const limit = Math.min(query.limit || 10, 100);

      const qb = this.createQueryBuilder('repeatPrescription')
        .innerJoin('patients', 'patient', 'patient.id = repeatPrescription.patientId')
        .where('patient.workspaceId = :workspaceId', { workspaceId })
        .andWhere('repeatPrescription.deletedAt IS NULL');

      // Apply filters
      if (query.patientId) {
        qb.andWhere('repeatPrescription.patientId = :patientId', {
          patientId: query.patientId,
        });
      }

      if (query.doctorId) {
        qb.andWhere('repeatPrescription.doctorId = :doctorId', {
          doctorId: query.doctorId,
        });
      }

      if (query.status) {
        qb.andWhere('repeatPrescription.status = :status', {
          status: query.status,
        });
      }

      if (query.isDue !== undefined && query.isDue) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        qb.andWhere('repeatPrescription.nextDueDate <= :today', { today });
        qb.andWhere('repeatPrescription.status = :activeStatus', {
          activeStatus: PrescriptionStatus.ACTIVE,
        });
      }

      if (query.requiresReview !== undefined && query.requiresReview) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        qb.andWhere('repeatPrescription.requiresReview = :requiresReview', {
          requiresReview: true,
        });
        qb.andWhere('repeatPrescription.reviewDate <= :today', { today });
      }

      // Apply sorting
      const sortBy = query.sortBy || 'createdAt';
      const sortOrder = query.sortOrder || 'DESC';
      qb.orderBy(`repeatPrescription.${sortBy}`, sortOrder);

      // Apply pagination
      qb.skip((page - 1) * limit).take(limit);

      const [repeatPrescriptions, total] = await qb.getManyAndCount();

      // Decrypt repeat prescriptions
      await Promise.all(
        repeatPrescriptions.map((rp) => this.decryptEntityFields(rp)),
      );

      this.logger.log(
        `Found ${repeatPrescriptions.length} repeat prescriptions with filters`,
      );

      return [repeatPrescriptions, total];
    } catch (error) {
      this.logger.error(
        'Error finding repeat prescriptions with filters',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find single repeat prescription by ID with workspace validation
   */
  async findOneByIdAndWorkspace(
    id: string,
    workspaceId: string,
  ): Promise<RepeatPrescription | null> {
    try {
      this.logger.log(
        `Finding repeat prescription by ID: ${id}, workspace: ${workspaceId}`,
      );

      const qb = this.createQueryBuilder('repeatPrescription')
        .innerJoin('patients', 'patient', 'patient.id = repeatPrescription.patientId')
        .where('patient.workspaceId = :workspaceId', { workspaceId })
        .andWhere('repeatPrescription.id = :id', { id })
        .andWhere('repeatPrescription.deletedAt IS NULL');

      const repeatPrescription = await qb.getOne();

      if (repeatPrescription) {
        await this.decryptEntityFields(repeatPrescription);
      }

      return repeatPrescription;
    } catch (error) {
      this.logger.error(
        `Error finding repeat prescription by ID: ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}
