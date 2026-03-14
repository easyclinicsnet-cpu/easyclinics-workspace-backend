import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere, SelectQueryBuilder } from 'typeorm';
import { Vital } from '../entities/vital.entity';
import { EncryptedRepository } from '../../../common/database/repositories/encrypted-repository.base';
import { Aes256Service } from '../../../common/security/encryption/aes-256.service';
import { LoggerService } from '../../../common/logger/logger.service';
import { VitalQueryDto } from '../dto/vital/vital-query.dto';

/**
 * Repository for Vital entity operations
 * Extends EncryptedRepository for automatic encryption/decryption of PHI fields.
 *
 * Encrypted fields: temperature, bloodPressure, heartRate, saturation,
 *                   gcs, bloodGlucose, height, weight
 *
 * Performance notes:
 *  • Patient JOIN removed from all find-many methods — VitalResponseDto only
 *    uses patientId (already on the vital row), not the full patient entity.
 *  • decryptEntityFields() called after every createQueryBuilder read since
 *    QueryBuilder results bypass the EncryptedRepository auto-decrypt hooks.
 */
@Injectable()
export class VitalRepository extends EncryptedRepository<Vital> {
  constructor(
    dataSource: DataSource,
    aesService: Aes256Service,
    logger: LoggerService,
  ) {
    super(Vital, dataSource, aesService, logger);
    this.logger.setContext('VitalRepository');
  }

  // O(1) Set lookup for sensitive vital measurement fields
  private static readonly VITAL_SENSITIVE = new Set([
    'temperature',
    'bloodPressure',
    'heartRate',
    'saturation',
    'gcs',
    'bloodGlucose',
    'height',
    'weight',
  ]);

  /**
   * Identify sensitive fields for encryption.
   * Vital measurement fields + any fields the parent considers sensitive.
   */
  protected isSensitiveField(key: string): boolean {
    return VitalRepository.VITAL_SENSITIVE.has(key) || super.isSensitiveField(key);
  }

  /**
   * Vitals are numeric measurements — not text-searchable via encrypted search.
   */
  protected getSearchableEncryptedFields(): string[] {
    return [];
  }

  /**
   * Default search filters
   */
  protected getSearchFilters(): Partial<FindOptionsWhere<Vital>> {
    return {};
  }

  /**
   * Find vitals with filters and pagination
   */
  async findWithFilters(
    query: VitalQueryDto,
    workspaceId: string,
  ): Promise<[Vital[], number]> {
    this.logger.log(`Finding vitals with filters - workspace: ${workspaceId}`);

    const qb = this.buildBaseQuery(query, workspaceId);

    const page = query.page || 1;
    const limit = query.limit || 10;
    qb.skip((page - 1) * limit).take(limit);

    const [vitals, total] = await qb.getManyAndCount();

    // Decrypt encrypted measurement fields for the page
    await Promise.all(vitals.map((v) => this.decryptEntityFields(v)));

    this.logger.log(`Found ${vitals.length} vitals out of ${total} total for workspace: ${workspaceId}`);

    return [vitals, total];
  }

  /**
   * Find vitals by patient ID with pagination
   */
  async findByPatient(
    patientId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[Vital[], number]> {
    this.logger.log(`Finding vitals for patient: ${patientId}, workspace: ${workspaceId}`);

    const [vitals, total] = await this.createQueryBuilder('vital')
      .where('vital.workspaceId = :workspaceId', { workspaceId })
      .andWhere('vital.patientId = :patientId', { patientId })
      .orderBy('vital.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    await Promise.all(vitals.map((v) => this.decryptEntityFields(v)));

    this.logger.log(`Found ${vitals.length} vitals out of ${total} for patient: ${patientId}`);

    return [vitals, total];
  }

  /**
   * Find vitals by appointment ID with pagination
   */
  async findByAppointment(
    appointmentId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[Vital[], number]> {
    this.logger.log(`Finding vitals for appointment: ${appointmentId}, workspace: ${workspaceId}`);

    const [vitals, total] = await this.createQueryBuilder('vital')
      .where('vital.workspaceId = :workspaceId', { workspaceId })
      .andWhere('vital.appointmentId = :appointmentId', { appointmentId })
      .orderBy('vital.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    await Promise.all(vitals.map((v) => this.decryptEntityFields(v)));

    this.logger.log(`Found ${vitals.length} vitals out of ${total} for appointment: ${appointmentId}`);

    return [vitals, total];
  }

  /**
   * Find the most recent vital entry for an appointment
   */
  async findFirstByAppointment(
    appointmentId: string,
    workspaceId: string,
  ): Promise<Vital | null> {
    this.logger.log(`Finding first vital entry for appointment: ${appointmentId}`);

    const vital = await this.createQueryBuilder('vital')
      .where('vital.workspaceId = :workspaceId', { workspaceId })
      .andWhere('vital.appointmentId = :appointmentId', { appointmentId })
      .orderBy('vital.createdAt', 'DESC')
      .getOne();

    if (vital) {
      await this.decryptEntityFields(vital);
      this.logger.log(`First vital entry found with ID: ${vital.id} for appointment: ${appointmentId}`);
    } else {
      this.logger.log(`No vital entry found for appointment: ${appointmentId}`);
    }

    return vital;
  }

  /**
   * Search vitals with text search on vital measurements.
   * Note: since vital fields are encrypted, LIKE search only works on
   * non-encrypted columns. For encrypted fields, decrypt-then-filter
   * approach would be needed (not implemented — vitals are queried by
   * patient/appointment, not by measurement value).
   */
  async searchVitals(
    searchTerm: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[Vital[], number]> {
    this.logger.log(`Searching vitals with term: "${searchTerm}", workspace: ${workspaceId}`);

    const qb = this.createQueryBuilder('vital')
      .where('vital.workspaceId = :workspaceId', { workspaceId })
      .andWhere(
        '(vital.bloodPressure LIKE :search OR vital.temperature LIKE :search OR vital.heartRate LIKE :search)',
        { search: `%${searchTerm}%` },
      )
      .orderBy('vital.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [vitals, total] = await qb.getManyAndCount();

    await Promise.all(vitals.map((v) => this.decryptEntityFields(v)));

    this.logger.log(`Vitals search completed - found ${vitals.length} out of ${total} for term: "${searchTerm}"`);

    return [vitals, total];
  }

  /**
   * Build base query with common filters — no patient JOIN.
   */
  private buildBaseQuery(
    query: VitalQueryDto,
    workspaceId: string,
  ): SelectQueryBuilder<Vital> {
    const qb = this.createQueryBuilder('vital')
      .where('vital.workspaceId = :workspaceId', { workspaceId });

    // Filter by patient ID
    if (query.patientId) {
      qb.andWhere('vital.patientId = :patientId', { patientId: query.patientId });
    }

    // Filter by appointment ID
    if (query.appointmentId) {
      qb.andWhere('vital.appointmentId = :appointmentId', { appointmentId: query.appointmentId });
    }

    // Filter by consultation ID
    if (query.consultationId) {
      qb.andWhere('vital.consultationId = :consultationId', { consultationId: query.consultationId });
    }

    // Apply sorting
    const sortBy = query.sortBy || 'createdAt';
    const sortDirection = query.sortOrder || 'DESC';
    qb.orderBy(`vital.${sortBy}`, sortDirection);

    return qb;
  }
}
