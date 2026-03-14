import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere, SelectQueryBuilder } from 'typeorm';
import { Consultation } from '../entities/consultation.entity';
import { ConsultationCollaborator } from '../entities/consultation-collaborator.entity';
import { Patient } from '../../patients/entities/patient.entity';
import { EncryptedRepository } from '../../../common/database/repositories/encrypted-repository.base';
import { Aes256Service } from '../../../common/security/encryption/aes-256.service';
import { LoggerService } from '../../../common/logger/logger.service';
import { ConsultationQueryDto } from '../dto';

/**
 * Repository for Consultation entity
 * Extends EncryptedRepository for automatic encryption/decryption
 * Multi-tenancy enforced via consultation.workspaceId
 *
 * Performance strategy (Big-O improvements on find-many paths):
 *  • appointment JOIN removed from all list queries — appointmentId column is
 *    already on consultation, so no JOIN is needed just to expose that field.
 *  • collaborators JOIN removed from all list queries — isUserCollaborator /
 *    userRole are computed in the DTO; they default to false/null when
 *    collaborators are not loaded, which is correct for list responses.
 *  • loadRelationCountAndMap removed — it fired one subquery per row → O(N).
 *    Replaced by attachNotesCount(): a single GROUP BY query for the page.
 *  • patient.workspaceId filter changed to consultation.workspaceId — the
 *    consultation entity has its own workspaceId column, so patient JOIN is
 *    now purely for fetching patient data, not for workspace filtering.
 */
@Injectable()
export class ConsultationRepository extends EncryptedRepository<Consultation> {
  /**
   * Patient PHI fields encrypted by PatientRepository but loaded via
   * leftJoinAndSelect('consultation.patient', …). The base-class
   * KNOWN_SENSITIVE already covers firstName, lastName, email — these
   * are the additional patient columns the base doesn't know about.
   */
  private static readonly CONSULTATION_SENSITIVE = new Set([
    'fileNumber',
    'phoneNumber',
    'birthDate',
    'gender',
    'medicalAid',
    'membershipNumber',
    'city',
  ]);

  constructor(
    protected readonly dataSource: DataSource,
    protected readonly aesService: Aes256Service,
    protected readonly logger: LoggerService,
  ) {
    super(Consultation, dataSource, aesService, logger);
    this.logger.setContext('ConsultationRepository');
  }

  /** Classify patient PHI that the base class doesn't know about. */
  protected override isSensitiveField(key: string): boolean {
    return (
      ConsultationRepository.CONSULTATION_SENSITIVE.has(key) ||
      super.isSensitiveField(key)
    );
  }

  /**
   * Patient encrypted fields that consultation search should match against.
   */
  protected getSearchableEncryptedFields(): string[] {
    return [
      'patient.firstName',
      'patient.lastName',
      'patient.fileNumber',
      'patient.email',
      'patient.phoneNumber',
    ];
  }

  /**
   * Default search filters
   */
  protected getSearchFilters(): Partial<FindOptionsWhere<Consultation>> {
    return { isActive: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FIND ONE / FIND BY ID — all relations kept
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Find consultation by ID with all relations (detail view).
   * All JOINs intentionally kept — this is the single-record path.
   */
  async findByIdWithRelations(
    id: string,
    workspaceId: string,
  ): Promise<Consultation | null> {
    this.logger.debug(`Finding consultation by ID: ${id}, workspace: ${workspaceId}`);

    const consultation = await this.createQueryBuilder('consultation')
      .leftJoinAndSelect('consultation.patient', 'patient')
      .leftJoinAndSelect('consultation.appointment', 'appointment')
      .leftJoinAndSelect('consultation.prescriptions', 'prescriptions')
      .leftJoinAndSelect('consultation.notes', 'notes')
      .leftJoinAndSelect('consultation.noteTimelines', 'noteTimelines')
      .leftJoinAndSelect('consultation.collaborators', 'collaborators')
      .leftJoinAndSelect('consultation.joinRequests', 'joinRequests')
      .where('consultation.id = :id', { id })
      .andWhere('patient.workspaceId = :workspaceId', { workspaceId })
      .andWhere('consultation.deletedAt IS NULL')
      .getOne();

    if (consultation) {
      await this.decryptEntityFields(consultation);
    }

    return consultation;
  }

  /**
   * Find consultation by appointment ID — single-record lookup.
   * appointment JOIN kept for workspace filter and detail data.
   */
  async findByAppointment(
    appointmentId: string,
    workspaceId: string,
  ): Promise<Consultation | null> {
    this.logger.debug(`Finding consultation by appointment: ${appointmentId}, workspace: ${workspaceId}`);

    const consultation = await this.createQueryBuilder('consultation')
      .leftJoinAndSelect('consultation.patient', 'patient')
      .leftJoinAndSelect('consultation.appointment', 'appointment')
      .where('consultation.appointmentId = :appointmentId', { appointmentId })
      .andWhere('appointment.workspaceId = :workspaceId', { workspaceId })
      .andWhere('consultation.deletedAt IS NULL')
      .getOne();

    if (consultation) {
      await this.decryptEntityFields(consultation);
    }

    return consultation;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FIND MANY — appointment + collaborator JOINs removed; notesCount batched
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Find consultations by patient ID with pagination.
   *
   * Removed: appointment JOIN, collaborators JOIN, loadRelationCountAndMap.
   * notesCount is fetched in a single batch query via attachNotesCount().
   * Workspace filter uses consultation.workspaceId directly (no JOIN needed).
   */
  async findByPatient(
    patientId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[Consultation[], number]> {
    this.logger.debug(`Finding consultations by patient: ${patientId}, workspace: ${workspaceId}`);

    const skip = (page - 1) * limit;

    const [consultations, total] = await this.createQueryBuilder('consultation')
      .leftJoinAndSelect('consultation.patient', 'patient')
      .where('consultation.patientId = :patientId', { patientId })
      .andWhere('consultation.workspaceId = :workspaceId', { workspaceId })
      .andWhere('consultation.deletedAt IS NULL')
      .orderBy('consultation.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    await Promise.all(consultations.map((c) => this.decryptEntityFields(c)));
    await this.attachNotesCount(consultations);

    return [consultations, total];
  }

  /**
   * Find consultations by doctor ID with pagination.
   *
   * Removed: appointment JOIN, collaborators JOIN, loadRelationCountAndMap.
   * notesCount is fetched in a single batch query via attachNotesCount().
   * Workspace filter uses consultation.workspaceId directly (no JOIN needed).
   */
  async findByDoctor(
    doctorId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[Consultation[], number]> {
    this.logger.debug(`Finding consultations by doctor: ${doctorId}, workspace: ${workspaceId}`);

    const skip = (page - 1) * limit;

    const [consultations, total] = await this.createQueryBuilder('consultation')
      .leftJoinAndSelect('consultation.patient', 'patient')
      .where('consultation.doctorId = :doctorId', { doctorId })
      .andWhere('consultation.workspaceId = :workspaceId', { workspaceId })
      .andWhere('consultation.deletedAt IS NULL')
      .orderBy('consultation.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    await Promise.all(consultations.map((c) => this.decryptEntityFields(c)));
    await this.attachNotesCount(consultations);

    return [consultations, total];
  }

  /**
   * Find consultations with advanced filters.
   *
   * Routes to encrypted search when query.search is present; otherwise
   * falls back to standard paginated DB query.
   */
  async findWithFilters(
    query: ConsultationQueryDto,
    workspaceId: string,
  ): Promise<[Consultation[], number]> {
    if (query.search?.trim()) {
      return this.searchWithEncryptedFieldsPaginated(query, workspaceId);
    }
    return this.findWithFiltersStandard(query, workspaceId);
  }

  /**
   * Standard paginated query (no free-text search).
   *
   * Removed: appointment JOIN, collaborators JOIN, loadRelationCountAndMap.
   * notesCount is fetched in a single batch query via attachNotesCount().
   * Workspace filter uses consultation.workspaceId directly (no JOIN needed).
   */
  private async findWithFiltersStandard(
    query: ConsultationQueryDto,
    workspaceId: string,
  ): Promise<[Consultation[], number]> {
    this.logger.debug(`Finding consultations with filters, workspace: ${workspaceId}`);

    const skip = ((query.page || 1) - 1) * (query.limit || 10);

    const qb = this.buildFilteredQuery(query, workspaceId);

    // Apply sorting and pagination
    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder || 'DESC';
    qb.orderBy(`consultation.${sortBy}`, sortOrder)
      .skip(skip)
      .take(query.limit || 10);

    const [consultations, total] = await qb.getManyAndCount();
    await Promise.all(consultations.map((c) => this.decryptEntityFields(c)));
    await this.attachNotesCount(consultations);

    return [consultations, total];
  }

  /**
   * Two-phase patient-first encrypted search.
   *
   * The old approach loaded up to 2 000 consultations ordered by createdAt DESC
   * and filtered in memory — any consultation beyond position 2 000 was never
   * searched.  This replacement is accurate for any workspace size:
   *
   *  Phase 1 — Search the patients table directly.
   *            All active patients in the workspace are loaded (field-projected),
   *            batch-decrypted, and matched against the search term.
   *            Matched patient IDs are collected.
   *
   *  Phase 2 — Query consultations WHERE patientId IN (matched IDs).
   *            All other filters (status, date, doctorId) are applied at the DB
   *            level.  Pagination is also done by the DB — no in-memory slice.
   */
  private async searchWithEncryptedFieldsPaginated(
    query: ConsultationQueryDto,
    workspaceId: string,
  ): Promise<[Consultation[], number]> {
    this.logger.log(`Two-phase patient search for: "${query.search}"`);

    // Phase 1: resolve matching patient IDs from the patients table.
    const { allIds, exactIds } = await this.findMatchingPatientIds(query.search!, workspaceId);
    if (allIds.length === 0) {
      return [[], 0];
    }

    // Phase 2: fetch consultations for matched patients with DB-level pagination.
    return this.findByPatientIdsWithFilters(allIds, query, workspaceId, exactIds);
  }

  /**
   * Build a QueryBuilder with all non-search filters applied.
   * Shared between standard and encrypted search paths.
   */
  private buildFilteredQuery(
    query: ConsultationQueryDto,
    workspaceId: string,
  ): SelectQueryBuilder<Consultation> {
    const qb = this.createQueryBuilder('consultation')
      .leftJoinAndSelect('consultation.patient', 'patient')
      .where('consultation.workspaceId = :workspaceId', { workspaceId })
      .andWhere('consultation.deletedAt IS NULL');

    if (query.patientId) {
      qb.andWhere('consultation.patientId = :patientId', { patientId: query.patientId });
    }

    if (query.appointmentId) {
      qb.andWhere('consultation.appointmentId = :appointmentId', { appointmentId: query.appointmentId });
    }

    if (query.doctorId) {
      qb.andWhere('consultation.doctorId = :doctorId', { doctorId: query.doctorId });
    }

    if (query.status) {
      qb.andWhere('consultation.status = :status', { status: query.status });
    }

    if (query.date) {
      const date = new Date(query.date);
      const startOfDay = new Date(date.setHours(0, 0, 0, 0));
      const endOfDay = new Date(date.setHours(23, 59, 59, 999));
      qb.andWhere('consultation.createdAt BETWEEN :startOfDay AND :endOfDay', {
        startOfDay,
        endOfDay,
      });
    }

    if (query.startDate) {
      qb.andWhere('consultation.createdAt >= :startDate', { startDate: new Date(query.startDate) });
    }

    if (query.endDate) {
      // Set to end-of-day so the entire selected day is included in the range
      const endDate = new Date(query.endDate);
      endDate.setHours(23, 59, 59, 999);
      qb.andWhere('consultation.createdAt <= :endDate', { endDate });
    }

    return qb;
  }

  /**
   * Returns true if the search term appears as a direct (normalised) substring
   * in any of the patient's searchable fields.
   * Used to separate "exact/contains" matches from Jaro-Winkler-only fuzzy
   * matches so that relevance-tier sorting can promote better results to the
   * top of the page without changing pagination counts.
   */
  private isSubstringPatientMatch(patient: Patient, searchTerm: string): boolean {
    const searchFields = [
      'firstName', 'lastName', 'fileNumber', 'email', 'phoneNumber', 'nationalId',
    ] as const;
    const normalizedSearch = this.normalizeSearchTerm(searchTerm);

    for (const field of searchFields) {
      const value = (patient as any)[field];
      if (value && typeof value === 'string') {
        if (this.normalizeSearchTerm(value).includes(normalizedSearch)) {
          return true;
        }
      }
    }

    // Multi-word: all words present somewhere across fields
    const searchWords = normalizedSearch.split(/\s+/);
    if (searchWords.length > 1) {
      const composite = searchFields
        .map((f) => {
          const v = (patient as any)[f];
          return v && typeof v === 'string' ? this.normalizeSearchTerm(String(v)) : '';
        })
        .join(' ');
      if (searchWords.every((word) => composite.includes(word))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check whether a (decrypted) patient record matches the search term.
   * Uses the same per-field + cross-field composite strategy as the old
   * in-consultation search, but operates on flat patient fields directly.
   */
  private patientMatchesSearch(patient: Patient, searchTerm: string): boolean {
    const searchFields = [
      'firstName', 'lastName', 'fileNumber', 'email', 'phoneNumber', 'nationalId',
    ] as const;
    const normalizedSearch = this.normalizeSearchTerm(searchTerm);

    // Strategy 1: per-field match (exact substring, multi-word, fuzzy)
    for (const field of searchFields) {
      const value = (patient as any)[field];
      if (value && typeof value === 'string') {
        if (this.matchesSearchTerm(value, searchTerm)) {
          return true;
        }
      }
    }

    // Strategy 2: cross-field composite (e.g. "John Doe" → firstName + lastName)
    const searchWords = normalizedSearch.split(/\s+/);
    if (searchWords.length > 1) {
      const composite = searchFields
        .map((f) => {
          const v = (patient as any)[f];
          return v && typeof v === 'string' ? this.normalizeSearchTerm(String(v)) : '';
        })
        .join(' ');
      if (searchWords.every((word) => composite.includes(word))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Phase 1: Load all active patients in the workspace, batch-decrypt, and
   * return the IDs of those that match the search term.
   *
   * Uses dataSource.getRepository(Patient) directly — no module change needed
   * because dataSource is already a protected property of EncryptedRepository.
   * Only the fields required for matching are selected to keep memory low.
   *
   * Big-O notes
   * ───────────
   * • O(P) AES decryptions where P = active patients in the workspace.
   *   This is unavoidable with encrypted fields — you must decrypt to compare.
   *   The patient domain itself does the same scan (PatientRepository.searchEncryptedFields).
   * • Capped at MAX_MATCHING_PATIENTS (500) to keep Phase 2's IN clause bounded.
   *   If a term matches >500 patients the first 500 are returned; this is an
   *   acceptable UX trade-off because the consultation results for 500 distinct
   *   patients already fill many pages of results.
   */
  private static readonly MAX_MATCHING_PATIENTS = 500;

  private async findMatchingPatientIds(
    searchTerm: string,
    workspaceId: string,
  ): Promise<{ allIds: string[]; exactIds: Set<string> }> {
    this.logger.debug(`Phase 1: searching patients for "${searchTerm}" in workspace ${workspaceId}`);

    const patients = await this.dataSource
      .getRepository(Patient)
      .createQueryBuilder('patient')
      .select([
        'patient.id',
        'patient.firstName',
        'patient.lastName',
        'patient.fileNumber',
        'patient.email',
        'patient.phoneNumber',
        'patient.nationalId',
      ])
      .where('patient.workspaceId = :workspaceId', { workspaceId })
      .andWhere('patient.isActive = :isActive', { isActive: true })
      .andWhere('patient.deletedAt IS NULL')
      .getMany();

    this.logger.debug(`Phase 1: decrypting ${patients.length} patients`);

    const matchingIds: string[] = [];
    const exactIds   = new Set<string>();
    const batchSize  = 100;

    for (let i = 0; i < patients.length; i += batchSize) {
      // Stop early once the cap is reached — avoids unnecessary decryptions.
      if (matchingIds.length >= ConsultationRepository.MAX_MATCHING_PATIENTS) break;

      const batch = patients.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (patient) => {
          try {
            // decryptEntityFields uses this.isSensitiveField() — ConsultationRepository
            // already overrides it to include all patient PHI (CONSULTATION_SENSITIVE),
            // so firstName, lastName, fileNumber, phoneNumber, email, nationalId are
            // all correctly decrypted here.
            await this.decryptEntityFields(patient);
          } catch (err) {
            this.logger.error(
              `Error decrypting patient ${patient.id} during search`,
              err instanceof Error ? err.stack : String(err),
            );
          }
        }),
      );

      for (const patient of batch) {
        if (
          matchingIds.length < ConsultationRepository.MAX_MATCHING_PATIENTS &&
          this.patientMatchesSearch(patient, searchTerm)
        ) {
          matchingIds.push(patient.id);
          // Track which patients matched via direct substring so Phase 2 can
          // promote them above Jaro-Winkler-only fuzzy matches.
          if (this.isSubstringPatientMatch(patient, searchTerm)) {
            exactIds.add(patient.id);
          }
        }
      }
    }

    this.logger.debug(
      `Phase 1: matched ${matchingIds.length} patients (${exactIds.size} exact/substring)`,
    );
    return { allIds: matchingIds, exactIds };
  }

  /**
   * Phase 2: Query consultations whose patientId is in the matched set,
   * applying all non-search filters and DB-level pagination.
   */
  private async findByPatientIdsWithFilters(
    patientIds: string[],
    query: ConsultationQueryDto,
    workspaceId: string,
    exactIds: Set<string>,
  ): Promise<[Consultation[], number]> {
    this.logger.debug(
      `Phase 2: querying consultations for ${patientIds.length} matched patients`,
    );

    const limit = query.limit || 10;
    const page  = query.page  || 1;
    const skip  = (page - 1) * limit;

    const qb = this.createQueryBuilder('consultation')
      .leftJoinAndSelect('consultation.patient', 'patient')
      .where('consultation.workspaceId = :workspaceId', { workspaceId })
      .andWhere('consultation.deletedAt IS NULL')
      .andWhere('consultation.patientId IN (:...patientIds)', { patientIds });

    // Apply all non-search filters (mirrors buildFilteredQuery)
    if (query.doctorId) {
      qb.andWhere('consultation.doctorId = :doctorId', { doctorId: query.doctorId });
    }

    if (query.status) {
      qb.andWhere('consultation.status = :status', { status: query.status });
    }

    if (query.date) {
      const date       = new Date(query.date);
      const startOfDay = new Date(date.setHours(0, 0, 0, 0));
      const endOfDay   = new Date(date.setHours(23, 59, 59, 999));
      qb.andWhere('consultation.createdAt BETWEEN :startOfDay AND :endOfDay', {
        startOfDay,
        endOfDay,
      });
    }

    if (query.startDate) {
      qb.andWhere('consultation.createdAt >= :startDate', {
        startDate: new Date(query.startDate),
      });
    }

    if (query.endDate) {
      const endDate = new Date(query.endDate);
      endDate.setHours(23, 59, 59, 999);
      qb.andWhere('consultation.createdAt <= :endDate', { endDate });
    }

    const sortBy    = query.sortBy    || 'createdAt';
    const sortOrder = query.sortOrder || 'DESC';

    qb.orderBy(`consultation.${sortBy}`, sortOrder)
      .skip(skip)
      .take(limit);

    const [consultations, total] = await qb.getManyAndCount();
    await Promise.all(consultations.map((c) => this.decryptEntityFields(c)));
    await this.attachNotesCount(consultations);

    // ── Relevance-tier sort ──────────────────────────────────────────────────
    // Promote exact/substring-match patients above Jaro-Winkler-only fuzzy
    // matches on the current page.  The DB already sorted by date within the
    // page; returning 0 for same-tier pairs preserves that ordering (stable).
    if (exactIds.size > 0 && exactIds.size < patientIds.length) {
      consultations.sort((a, b) => {
        const aRank = exactIds.has(a.patientId) ? 0 : 1;
        const bRank = exactIds.has(b.patientId) ? 0 : 1;
        return aRank - bRank;
      });
    }

    return [consultations, total];
  }

  /**
   * Get recent consultations within specified days.
   *
   * Removed: appointment JOIN, loadRelationCountAndMap.
   * notesCount is fetched in a single batch query via attachNotesCount().
   * Workspace filter uses consultation.workspaceId directly (no JOIN needed).
   */
  async getRecentConsultations(
    workspaceId: string,
    days: number = 30,
    page: number = 1,
    limit: number = 10,
  ): Promise<[Consultation[], number]> {
    this.logger.debug(`Getting recent consultations (${days} days), workspace: ${workspaceId}`);

    const skip = (page - 1) * limit;
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - days);

    const [consultations, total] = await this.createQueryBuilder('consultation')
      .leftJoinAndSelect('consultation.patient', 'patient')
      .where('consultation.workspaceId = :workspaceId', { workspaceId })
      .andWhere('consultation.createdAt >= :dateThreshold', { dateThreshold })
      .andWhere('consultation.deletedAt IS NULL')
      .orderBy('consultation.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    await Promise.all(consultations.map((c) => this.decryptEntityFields(c)));
    await this.attachNotesCount(consultations);

    return [consultations, total];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COLLABORATOR HELPERS — unchanged
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Check if user is a collaborator on consultation
   */
  async isUserCollaborator(
    consultationId: string,
    userId: string,
    workspaceId: string,
  ): Promise<boolean> {
    this.logger.debug(`Checking if user ${userId} is collaborator on consultation: ${consultationId}`);

    const count = await this.createQueryBuilder('consultation')
      .innerJoin('consultation.collaborators', 'collaborator')
      .innerJoin('consultation.patient', 'patient')
      .where('consultation.id = :consultationId', { consultationId })
      .andWhere('collaborator.userId = :userId', { userId })
      .andWhere('collaborator.isActive = :isActive', { isActive: true })
      .andWhere('collaborator.deletedAt IS NULL')
      .andWhere('patient.workspaceId = :workspaceId', { workspaceId })
      .getCount();

    return count > 0;
  }

  /**
   * Get user collaborator info for consultation
   */
  async getUserCollaboratorInfo(
    consultationId: string,
    userId: string,
    workspaceId: string,
  ): Promise<ConsultationCollaborator | null> {
    this.logger.debug(`Getting collaborator info for user ${userId} on consultation: ${consultationId}`);

    const collaborator = await this.dataSource
      .getRepository(ConsultationCollaborator)
      .createQueryBuilder('collaborator')
      .innerJoin('collaborator.consultation', 'consultation')
      .innerJoin('consultation.patient', 'patient')
      .where('collaborator.consultationId = :consultationId', { consultationId })
      .andWhere('collaborator.userId = :userId', { userId })
      .andWhere('collaborator.isActive = :isActive', { isActive: true })
      .andWhere('collaborator.deletedAt IS NULL')
      .andWhere('patient.workspaceId = :workspaceId', { workspaceId })
      .getOne();

    return collaborator;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Batch-fetch notes count for a page of consultations.
   *
   * Runs one GROUP BY query for at most N consultation IDs (page size).
   * Replaces loadRelationCountAndMap which fired one subquery per row → O(N).
   *
   * Sets (consultation as any).notesCount so ConsultationResponseDto.fromEntity
   * picks it up via the `!!((entity as any).notesCount > 0)` branch.
   */
  private async attachNotesCount(consultations: Consultation[]): Promise<void> {
    if (consultations.length === 0) return;

    const ids = consultations.map((c) => c.id);

    const rows = await this.createQueryBuilder('c')
      .select('c.id', 'id')
      .addSelect('COUNT(note.id)', 'notesCount')
      .leftJoin('c.notes', 'note')
      .where('c.id IN (:...ids)', { ids })
      .groupBy('c.id')
      .getRawMany<{ id: string; notesCount: string }>();

    const countMap = new Map(
      rows.map((r) => [r.id, parseInt(r.notesCount, 10)]),
    );

    for (const consultation of consultations) {
      (consultation as any).notesCount = countMap.get(consultation.id) ?? 0;
    }
  }
}
