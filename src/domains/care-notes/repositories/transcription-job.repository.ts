import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere } from 'typeorm';
import { EncryptedRepository } from '../../../common/database/repositories/encrypted-repository.base';
import { Aes256Service } from '../../../common/security/encryption/aes-256.service';
import { LoggerService } from '../../../common/logger/logger.service';
import { TranscriptionJob } from '../entities/transcription-job.entity';
import { TranscriptionStatus, TranscriptionMode } from '../../../common/enums';

/**
 * Sensitive fields on TranscriptionJob that must be encrypted at rest.
 *
 * These contain PHI / clinical content and fall under HIPAA's
 * encryption-at-rest requirements:
 *
 *  - rawTranscribedText  – verbatim STT output (medical speech)
 *  - transcriptPreview   – first 500 chars of structured transcript
 *  - patientName         – PII
 *  - context             – doctor-supplied clinical guidance
 */
const TRANSCRIPTION_SENSITIVE_FIELDS = new Set([
  'rawTranscribedText',
  'transcriptPreview',
  'patientName',
  'context',
]);

/**
 * TranscriptionJobRepository
 *
 * Encrypted repository for background transcription job management.
 * Extends EncryptedRepository to automatically encrypt/decrypt PHI fields
 * (rawTranscribedText, transcriptPreview, patientName, context) at rest.
 *
 * Provides specialized queries for the polling-based processing pipeline:
 * - Finding pending jobs for processing
 * - Finding stuck/timed-out jobs
 * - Filtering by doctor, status, consultation, and date range
 * - Multi-tenant workspace isolation
 */
@Injectable()
export class TranscriptionJobRepository extends EncryptedRepository<TranscriptionJob> {
  constructor(
    dataSource: DataSource,
    aesService: Aes256Service,
    logger: LoggerService,
  ) {
    super(TranscriptionJob, dataSource, aesService, logger);
    this.logger.setContext('TranscriptionJobRepository');
  }

  // ── EncryptedRepository abstract methods ──────────────────────────────────

  protected getSearchableEncryptedFields(): string[] {
    return ['rawTranscribedText', 'patientName'];
  }

  protected getSearchFilters(): Partial<FindOptionsWhere<TranscriptionJob>> {
    return {};
  }

  /**
   * Override to include transcription-specific sensitive fields that don't
   * match the base class's default KNOWN_SENSITIVE set or SENSITIVE_RE regex.
   */
  protected override isSensitiveField(key: string): boolean {
    if (TRANSCRIPTION_SENSITIVE_FIELDS.has(key)) return true;
    return super.isSensitiveField(key);
  }

  // ── Pipeline queries ──────────────────────────────────────────────────────

  /**
   * Find pending transcriptions that are ready for processing.
   * Orders by creation time (FIFO) to ensure fair ordering.
   *
   * @param workspaceId - Tenant workspace ID
   * @param limit - Maximum number of items to fetch (default 5)
   * @returns Array of pending transcription entities
   */
  async findPending(
    workspaceId: string,
    limit: number = 5,
  ): Promise<TranscriptionJob[]> {
    return this.find({
      where: {
        workspaceId,
        status: TranscriptionStatus.PENDING,
      },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  /**
   * Find pending transcriptions across ALL workspaces for the background poller.
   * Used by the interval-based processor.
   *
   * @param limit - Maximum number of items to fetch (default 5)
   * @returns Array of pending transcription entities
   */
  async findAllPending(limit: number = 5): Promise<TranscriptionJob[]> {
    return this.find({
      where: { status: TranscriptionStatus.PENDING },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  /**
   * Find transcriptions by doctor with optional filters.
   * Supports filtering by status, consultation ID, and date range.
   *
   * Note: Uses QueryBuilder so results bypass automatic decryption.
   * The caller must decrypt sensitive fields manually if needed.
   *
   * @param doctorId - Doctor ID
   * @param workspaceId - Tenant workspace ID
   * @param filters - Optional filters
   * @returns Array of transcription entities matching filters
   */
  async findByDoctor(
    doctorId: string,
    workspaceId: string,
    filters?: {
      status?: TranscriptionStatus;
      mode?: TranscriptionMode;
      consultationId?: string;
      fromDate?: Date;
      toDate?: Date;
      limit?: number;
      offset?: number;
    },
  ): Promise<[TranscriptionJob[], number]> {
    const qb = this.createQueryBuilder('bt')
      .where('bt.doctorId = :doctorId', { doctorId })
      .andWhere('bt.workspaceId = :workspaceId', { workspaceId });

    if (filters?.status) {
      qb.andWhere('bt.status = :status', { status: filters.status });
    }

    if (filters?.mode) {
      qb.andWhere('bt.mode = :mode', { mode: filters.mode });
    }

    if (filters?.consultationId) {
      qb.andWhere('bt.consultationId = :consultationId', {
        consultationId: filters.consultationId,
      });
    }

    if (filters?.fromDate) {
      qb.andWhere('bt.createdAt >= :fromDate', { fromDate: filters.fromDate });
    }

    if (filters?.toDate) {
      qb.andWhere('bt.createdAt <= :toDate', { toDate: filters.toDate });
    }

    qb.orderBy('bt.createdAt', 'DESC');

    if (filters?.offset) {
      qb.skip(filters.offset);
    }

    if (filters?.limit) {
      qb.take(filters.limit);
    }

    const [items, count] = await qb.getManyAndCount();

    // QueryBuilder bypasses the overridden find() — decrypt manually
    await Promise.all(items.map((e) => this.decryptEntityFields(e)));

    return [items, count];
  }

  /**
   * Find transcriptions stuck in PROCESSING state for longer than timeout.
   * Used by the stuck process detection mechanism.
   *
   * @param timeoutMinutes - Number of minutes after which a process is considered stuck (default 30)
   * @returns Array of stuck transcription entities
   */
  async findStuckProcesses(
    timeoutMinutes: number = 30,
  ): Promise<TranscriptionJob[]> {
    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);

    const items = await this.createQueryBuilder('bt')
      .where('bt.status = :status', { status: TranscriptionStatus.PROCESSING })
      .andWhere('bt.updatedAt < :cutoff', { cutoff })
      .orderBy('bt.updatedAt', 'ASC')
      .getMany();

    // QueryBuilder bypasses the overridden find() — decrypt manually
    await Promise.all(items.map((e) => this.decryptEntityFields(e)));

    return items;
  }

  /**
   * Find by doctor and specific status with pagination.
   *
   * @param doctorId - Doctor ID
   * @param workspaceId - Tenant workspace ID
   * @param status - Transcription status
   * @param page - Page number (1-based)
   * @param limit - Items per page
   * @returns Tuple of [items, totalCount]
   */
  async findByDoctorAndStatus(
    doctorId: string,
    workspaceId: string,
    status: TranscriptionStatus,
    page: number = 1,
    limit: number = 10,
  ): Promise<[TranscriptionJob[], number]> {
    const skip = (page - 1) * limit;

    return this.findAndCount({
      where: {
        doctorId,
        workspaceId,
        status,
      },
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
  }
}
