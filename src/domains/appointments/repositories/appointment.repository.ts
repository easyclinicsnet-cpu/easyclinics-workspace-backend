import { Injectable } from '@nestjs/common';
import {
  DataSource,
  FindOptionsWhere,
  SelectQueryBuilder,
} from 'typeorm';
import { Appointment } from '../entities/appointment.entity';
import { QueryAppointmentsDto } from '../dtos/query-appointments.dto';
import { EncryptedRepository } from '../../../common/database/repositories/encrypted-repository.base';
import { Aes256Service } from '../../../common/security/encryption/aes-256.service';
import { LoggerService } from '../../../common/logger/logger.service';
import { AppointmentStatus } from '../../../common/enums';
import { Consultation } from '../../consultations/entities/consultation.entity';
import { PatientBill } from '../../billing/entities/patient-bill.entity';
import { Patient } from '../../patients/entities/patient.entity';
import { Vital } from '../../patients/entities/vital.entity';

/**
 * Paginated appointment result with search metadata
 */
export interface PaginatedAppointmentResult {
  data: Appointment[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  searchMetadata?: {
    searchTerm: string;
    searchMethod: 'encrypted' | 'standard';
    executionTime: number;
    cacheHit: boolean;
  };
}

/**
 * Appointment Repository
 * Extends EncryptedRepository for encrypted field search capabilities
 *
 * Features:
 * - Encrypted field search with caching
 * - Multi-tenancy support via workspaceId
 * - Advanced filtering and pagination
 * - Batch processing for large datasets
 *
 * Performance strategy (Big-O improvements):
 *  • buildBaseQuery: 3 JOINs only (ManyToOne/OneToOne — no row-multiplication)
 *    but NO loadRelationCountAndMap (which fired N subqueries per row → O(N)).
 *  • executeQueryWithDecryption: getManyAndCount() (1 DB round-trip) instead of
 *    clone().getCount() + getMany() (2 round-trips). Then a single batch COUNT
 *    for notes on the displayed page only via attachNotesCount().
 *  • searchWithEncryptedFieldsPaginated: loads only patient JOIN during search
 *    (no bill/consultation JOIN); decrypts in parallel batches; batch-fetches
 *    bill + notesCount for the displayed page only via attachBillsAndNotesCount().
 *  • findOneWithDetails: no loadRelationCountAndMap; notes count via 1 extra query.
 *  • isSensitiveField: O(1) Set lookup instead of O(N) array scan per field.
 */
@Injectable()
export class AppointmentRepository extends EncryptedRepository<Appointment> {
  constructor(
    dataSource: DataSource,
    aesService: Aes256Service,
    logger: LoggerService,
  ) {
    super(Appointment, dataSource, aesService, logger);
    this.logger.setContext('AppointmentRepository');
  }

  // O(1) — cached at class level.
  // Includes all patient PHI fields encrypted by PatientRepository that are
  // absent from the base-class KNOWN_SENSITIVE set.  Without these, the nested
  // patient object loaded via leftJoinAndSelect arrives with raw ciphertext and
  // appointmentMatchesSearchSync cannot match on fileNumber / phoneNumber / etc.
  private static readonly APPOINTMENT_SENSITIVE = new Set([
    'transcriptionId',
    // Patient PHI encrypted by PatientRepository but not in base KNOWN_SENSITIVE:
    'fileNumber',
    'phoneNumber',
    'birthDate',
    'gender',
    'medicalAid',
    'membershipNumber',
    'city',
  ]);

  /**
   * Hard cap on matched patient IDs passed to Phase 2's IN clause.
   * Keeps the SQL parameter list bounded (MySQL degrades above ~500 IN params)
   * and short-circuits unnecessary AES decryptions once the cap is reached.
   * In practice, a search term that matches >500 patients already fills many
   * result pages — no useful UX value in scanning further.
   */
  private static readonly MAX_MATCHING_PATIENTS = 500;

  /**
   * Define searchable encrypted fields
   * These fields will be searched when using encrypted search
   */
  protected getSearchableEncryptedFields(): string[] {
    return [
      'patient.firstName',
      'patient.lastName',
      'patient.fileNumber',
      'patient.email',
      'patient.phoneNumber',
      'transcriptionId',
    ];
  }

  /**
   * Define default search filters
   * Applied to all search queries
   */
  protected getSearchFilters(): Partial<FindOptionsWhere<Appointment>> {
    return {
      isActive: true,
    };
  }

  /**
   * Main search method with proper pagination support
   * Supports both encrypted search and standard database search
   */
  async searchAppointments(
    query: QueryAppointmentsDto,
  ): Promise<PaginatedAppointmentResult> {
    const startTime = Date.now();
    const page = query.page || 1;
    const limit = query.limit || 10;

    let appointments: Appointment[] = [];
    let total = 0;
    let searchMethod: 'encrypted' | 'standard' = 'standard';
    let cacheHit = false;

    // If there's a search term, use encrypted search
    if (query.search?.trim()) {
      searchMethod = 'encrypted';
      const result = await this.searchWithEncryptedFieldsPaginated(
        query,
        page,
        limit,
      );
      appointments = result.appointments;
      total = result.total;
      cacheHit = result.cacheHit;
    } else {
      // Use standard database search
      const [standardResults, standardTotal] =
        await this.findWithFiltersStandard(query);
      appointments = standardResults;
      total = standardTotal;
    }

    const executionTime = Date.now() - startTime;
    const totalPages = Math.ceil(total / limit);

    return {
      data: appointments,
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
      searchMetadata: {
        searchTerm: query.search || '',
        searchMethod,
        executionTime,
        cacheHit,
      },
    };
  }

  /**
   * Find a single appointment with patient, bill, and care-notes count.
   *
   * Performance: loadRelationCountAndMap removed (fired N subqueries per row).
   * Instead, a single batch COUNT query is issued via attachNotesCount().
   */
  async findOneWithDetails(id: string, workspaceId: string): Promise<Appointment | null> {
    const appointment = await this.createQueryBuilder('appointment')
      .leftJoinAndSelect('appointment.patient', 'patient')
      .leftJoinAndSelect('appointment.patientBill', 'bill')
      .leftJoinAndSelect('appointment.consultation', 'consultation')
      .where('appointment.id = :id', { id })
      .andWhere('appointment.workspaceId = :workspaceId', { workspaceId })
      .getOne();

    if (appointment) {
      await Promise.all([
        this.attachNotesCount([appointment]),
        this.attachVitalsCount([appointment]),
      ]);
    }

    return appointment;
  }

  /**
   * Build base query with all filters.
   *
   * Performance: loadRelationCountAndMap removed — it fired one subquery per
   * result row (O(N)). Notes count is now fetched in a single batch query by
   * attachNotesCount() after the page has been determined.
   */
  private buildBaseQuery(
    query: QueryAppointmentsDto,
    isActiveOnly: boolean = false,
  ): SelectQueryBuilder<Appointment> {
    const qb = this.createQueryBuilder('appointment')
      .leftJoinAndSelect('appointment.patient', 'patient')
      .leftJoinAndSelect('appointment.patientBill', 'bill')
      .leftJoinAndSelect('appointment.consultation', 'consultation');
    // NOTE: loadRelationCountAndMap intentionally removed — see attachNotesCount()

    // Multi-tenancy filter
    if (query.workspaceId) {
      qb.andWhere('appointment.workspaceId = :workspaceId', {
        workspaceId: query.workspaceId,
      });
    }

    // Apply filters
    if (query.status) {
      qb.andWhere('appointment.status = :status', { status: query.status });
    }

    if (query.type) {
      qb.andWhere('appointment.type = :type', { type: query.type });
    }

    if (query.patientId) {
      qb.andWhere('patient.id = :patientId', { patientId: query.patientId });
    }

    if (query.practitionerId) {
      qb.andWhere('appointment.userId = :practitionerId', {
        practitionerId: query.practitionerId,
      });
    }

    if (query.date) {
      qb.andWhere('appointment.date = :date', { date: query.date });
    }

    if (query.hasDateRange && query.startDate && query.endDate) {
      qb.andWhere('appointment.date BETWEEN :startDate AND :endDate', {
        startDate: query.startDate,
        endDate: query.endDate,
      });
    }

    // Handle cancelled appointments filter
    if (!query.includeCancelled) {
      qb.andWhere('appointment.status != :cancelledStatus', {
        cancelledStatus: AppointmentStatus.CANCELLED,
      });
    }

    // Apply active filter if needed
    if (isActiveOnly || query.isActive) {
      const activeStatuses = [
        AppointmentStatus.SCHEDULED,
        AppointmentStatus.IN_PROGRESS,
      ];
      qb.andWhere('appointment.status IN (:...activeStatuses)', {
        activeStatuses,
      });
    }

    return qb;
  }

  /**
   * Standard search with proper pagination
   */
  private async findWithFiltersStandard(
    query: QueryAppointmentsDto,
  ): Promise<[Appointment[], number]> {
    const qb = this.buildBaseQuery(query);
    return this.executeQueryWithDecryption(qb, query);
  }

  /**
   * Legacy method for backward compatibility
   */
  async findWithFilters(
    query: QueryAppointmentsDto,
  ): Promise<[Appointment[], number]> {
    // Handle search - use encrypted search if search term is provided
    if (query.search) {
      const result = await this.searchWithEncryptedFieldsPaginated(
        query,
        query.page || 1,
        query.limit || 10,
      );
      return [result.appointments, result.total];
    }

    const qb = this.buildBaseQuery(query);
    return this.executeQueryWithDecryption(qb, query);
  }

  /**
   * Legacy method for active appointments
   */
  async findActiveWithFilters(
    query: QueryAppointmentsDto,
  ): Promise<[Appointment[], number]> {
    // Handle search - use encrypted search if search term is provided
    if (query.search) {
      const result = await this.searchWithEncryptedFieldsPaginated(
        query,
        query.page || 1,
        query.limit || 10,
        true,
      );
      return [result.appointments, result.total];
    }

    const qb = this.buildBaseQuery(query, true); // true means activeOnly
    return this.executeQueryWithDecryption(qb, query);
  }

  /**
   * Two-phase patient-first encrypted search.
   *
   * The old approach loaded up to 2 000 appointments ordered by date DESC and
   * filtered in memory — any appointment beyond position 2 000 was never found.
   * This replacement is accurate for any workspace size:
   *
   *  Phase 1 — Search the patients table directly.
   *            All active patients in the workspace are loaded (field-projected),
   *            batch-decrypted, and matched against the search term.
   *            Results are capped at MAX_MATCHING_PATIENTS (500) to keep Phase 2's
   *            IN clause bounded; decryption stops early once the cap is reached.
   *
   *  Phase 2 — Query appointments WHERE patient.id IN (matched IDs).
   *            Reuses buildBaseQuery() so all existing non-search filters (status,
   *            date, practitionerId, activeOnly, etc.) remain applied at the DB
   *            level.  Pagination is DB-level LIMIT/OFFSET — no in-memory slice.
   *
   * Note: transcriptionId (an appointment-specific encrypted field) is not
   * searchable via this path, as it lives on the appointment row, not the patient.
   * Patient name, fileNumber, email, phoneNumber, and nationalId are searched.
   */
  private async searchWithEncryptedFieldsPaginated(
    query: QueryAppointmentsDto,
    page: number,
    limit: number,
    activeOnly: boolean = false,
  ): Promise<{
    appointments: Appointment[];
    total: number;
    cacheHit: boolean;
  }> {
    this.logger.log(`Two-phase patient search for: "${query.search}"`);

    // Phase 1: resolve matching patient IDs from the patients table.
    const { allIds, exactIds } = await this.findMatchingPatientIds(
      query.search!,
      query.workspaceId,
    );
    if (allIds.length === 0) {
      return { appointments: [], total: 0, cacheHit: false };
    }

    // Phase 2: fetch appointments for matched patients with DB-level pagination.
    const [appointments, total] = await this.findByPatientIdsWithFilters(
      allIds,
      exactIds,
      query,
      page,
      limit,
      activeOnly,
    );

    return { appointments, total, cacheHit: false };
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
   * Per-field match (exact substring, multi-word, fuzzy via base-class
   * matchesSearchTerm) plus cross-field composite so "John Doe" hits
   * firstName="John" + lastName="Doe".
   *
   * Fields searched: firstName, lastName, fileNumber, email, phoneNumber,
   * nationalId.  transcriptionId is appointment-specific and not on the patient
   * row, so it is excluded from this path.
   */
  private patientMatchesSearch(patient: Patient, searchTerm: string): boolean {
    const searchFields = [
      'firstName', 'lastName', 'fileNumber', 'email', 'phoneNumber', 'nationalId',
    ] as const;
    const normalizedSearch = this.normalizeSearchTerm(searchTerm);

    // Strategy 1: per-field match
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
   * Big-O: O(P) AES decryptions where P = active patients in workspace.
   * This is unavoidable for encrypted fields — same as PatientRepository search.
   * Stops early once MAX_MATCHING_PATIENTS is collected (avoids redundant work).
   */
  private async findMatchingPatientIds(
    searchTerm: string,
    workspaceId: string | undefined,
  ): Promise<{ allIds: string[]; exactIds: Set<string> }> {
    if (!workspaceId) return { allIds: [], exactIds: new Set() };

    this.logger.debug(`Phase 1: searching patients for "${searchTerm}" in workspace ${workspaceId}`);

    // Select only the fields needed for matching — minimises row payload.
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
      // Short-circuit: no point decrypting further once the cap is reached.
      if (matchingIds.length >= AppointmentRepository.MAX_MATCHING_PATIENTS) break;

      const batch = patients.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (patient) => {
          try {
            // isSensitiveField() covers all patient PHI via APPOINTMENT_SENSITIVE +
            // base-class KNOWN_SENSITIVE, so all six matched fields decrypt correctly.
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
          matchingIds.length < AppointmentRepository.MAX_MATCHING_PATIENTS &&
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
   * Phase 2: Query appointments whose patient.id is in the matched set.
   *
   * Reuses buildBaseQuery() so all existing non-search filters (status, type,
   * date range, practitionerId, activeOnly, cancelled exclusion) are applied
   * at the DB level.  Sorting and pagination are also DB-level — no in-memory
   * sort or slice.  attachBillsAndNotesCount() enriches the displayed page only.
   */
  private async findByPatientIdsWithFilters(
    patientIds: string[],
    exactIds: Set<string>,
    query: QueryAppointmentsDto,
    page: number,
    limit: number,
    activeOnly: boolean,
  ): Promise<[Appointment[], number]> {
    this.logger.debug(
      `Phase 2: querying appointments for ${patientIds.length} matched patients`,
    );

    const skip = (page - 1) * limit;

    // buildBaseQuery already applies workspaceId, status, type, date, cancelled,
    // activeOnly, and loads the patient / bill / consultation relations.
    const qb = this.buildBaseQuery(query, activeOnly)
      .andWhere('patient.id IN (:...patientIds)', { patientIds });

    const sortField     = query.sortBy    || 'date';
    const sortDirection = query.sortOrder || 'ASC';

    qb.orderBy(`appointment.${sortField}`, sortDirection)
      .addOrderBy('appointment.time', 'ASC')
      .skip(skip)
      .take(limit);

    const [appointments, total] = await qb.getManyAndCount();

    await Promise.all(appointments.map((a) => this.decryptEntityFields(a)));

    if (appointments.length > 0) {
      await this.attachBillsAndNotesCount(appointments);
    }

    // ── Relevance-tier sort ──────────────────────────────────────────────────
    // Promote exact/substring-match patients above Jaro-Winkler-only fuzzy
    // matches on the current page.  The DB already sorted by date within the
    // page; returning 0 for same-tier pairs preserves that ordering (stable).
    if (exactIds.size > 0 && exactIds.size < patientIds.length) {
      appointments.sort((a, b) => {
        const aRank = exactIds.has(a.patientId) ? 0 : 1;
        const bRank = exactIds.has(b.patientId) ? 0 : 1;
        return aRank - bRank;
      });
    }

    return [appointments, total];
  }

  /**
   * Execute query with decryption.
   *
   * Performance: getManyAndCount() issues a single DB round-trip (was 2:
   * clone().getCount() + getMany()). Then a single batch notes-count query
   * for the displayed page replaces the per-row loadRelationCountAndMap.
   */
  private async executeQueryWithDecryption(
    qb: SelectQueryBuilder<Appointment>,
    query: QueryAppointmentsDto,
  ): Promise<[Appointment[], number]> {
    const sortField = query.sortBy || 'date';
    const sortDirection = query.sortOrder || 'ASC';

    // Apply ordering and pagination before getManyAndCount
    qb.orderBy(`appointment.${sortField}`, sortDirection)
      .addOrderBy('appointment.time', 'ASC')
      .skip(query.skip)
      .take(query.limit);

    // Single round-trip: count + data together
    const [appointments, total] = await qb.getManyAndCount();

    // Parallel decrypt for the page (typically 10 rows)
    await Promise.all(
      appointments.map((appointment) => this.decryptEntityFields(appointment)),
    );

    // Batch notes count + vitals count for only this page
    if (appointments.length > 0) {
      await Promise.all([
        this.attachNotesCount(appointments),
        this.attachVitalsCount(appointments),
      ]);
    }

    return [appointments, total];
  }

  /**
   * Batch-fetch notes count for a small set of appointments.
   *
   * Used by standard list and findOneWithDetails.
   * Runs a single GROUP BY query: SELECT c.id, COUNT(note.id)
   * WHERE c.id IN (…N ids…) GROUP BY c.id
   * N = page size (typically 10) — always fast regardless of table size.
   *
   * Replaces loadRelationCountAndMap which fired one subquery per row → O(N).
   */
  private async attachNotesCount(appointments: Appointment[]): Promise<void> {
    const consultationIds = appointments
      .map((a) => a.consultationId)
      .filter((id): id is string => !!id);

    if (consultationIds.length === 0) return;

    const rows = await this.dataSource
      .getRepository(Consultation)
      .createQueryBuilder('c')
      .select('c.id', 'id')
      .addSelect('COUNT(note.id)', 'notesCount')
      .leftJoin('c.notes', 'note')
      .where('c.id IN (:...consultationIds)', { consultationIds })
      .groupBy('c.id')
      .getRawMany<{ id: string; notesCount: string }>();

    const countMap = new Map(
      rows.map((r) => [r.id, parseInt(r.notesCount, 10)]),
    );

    for (const appt of appointments) {
      if (appt.consultationId && appt.consultation) {
        (appt.consultation as any).notesCount =
          countMap.get(appt.consultationId) ?? 0;
      }
    }
  }

  /**
   * Batch-fetch vitals count for a small set of appointments.
   *
   * Runs a single GROUP BY query: SELECT appointmentId, COUNT(v.id)
   * WHERE appointmentId IN (…N ids…) GROUP BY appointmentId
   * N = page size (typically 10) — always fast regardless of table size.
   */
  private async attachVitalsCount(appointments: Appointment[]): Promise<void> {
    const appointmentIds = appointments.map((a) => a.id);
    if (appointmentIds.length === 0) return;

    const rows = await this.dataSource
      .getRepository(Vital)
      .createQueryBuilder('v')
      .select('v.appointmentId', 'appointmentId')
      .addSelect('COUNT(v.id)', 'vitalsCount')
      .where('v.appointmentId IN (:...appointmentIds)', { appointmentIds })
      .groupBy('v.appointmentId')
      .getRawMany<{ appointmentId: string; vitalsCount: string }>();

    const countMap = new Map(
      rows.map((r) => [r.appointmentId, parseInt(r.vitalsCount, 10)]),
    );

    for (const appt of appointments) {
      (appt as any).vitalsCount = countMap.get(appt.id) ?? 0;
    }
  }

  /**
   * Batch-fetch bills AND notes count for a small set of appointments.
   *
   * Used by the encrypted search path after pagination — the search phase
   * only loads the patient relation for matching, so bill and consultation
   * data must be attached for the displayed page here.
   *
   * Runs 2 parallel queries (bills + notes count) for at most N rows.
   */
  private async attachBillsAndNotesCount(appointments: Appointment[]): Promise<void> {
    const appointmentIds = appointments.map((a) => a.id);
    const consultationIds = appointments
      .map((a) => a.consultationId)
      .filter((id): id is string => !!id);

    const [bills, notesCountRows, vitalsCountRows] = await Promise.all([
      // Bills for this page only
      this.dataSource
        .getRepository(PatientBill)
        .createQueryBuilder('bill')
        .select(['bill.id', 'bill.appointmentId'])
        .where('bill.appointmentId IN (:...appointmentIds)', { appointmentIds })
        .getMany(),

      // Notes count per consultation for this page only
      consultationIds.length > 0
        ? this.dataSource
            .getRepository(Consultation)
            .createQueryBuilder('c')
            .select('c.id', 'id')
            .addSelect('COUNT(note.id)', 'notesCount')
            .leftJoin('c.notes', 'note')
            .where('c.id IN (:...consultationIds)', { consultationIds })
            .groupBy('c.id')
            .getRawMany<{ id: string; notesCount: string }>()
        : Promise.resolve([]),

      // Vitals count per appointment for this page only
      this.dataSource
        .getRepository(Vital)
        .createQueryBuilder('v')
        .select('v.appointmentId', 'appointmentId')
        .addSelect('COUNT(v.id)', 'vitalsCount')
        .where('v.appointmentId IN (:...appointmentIds)', { appointmentIds })
        .groupBy('v.appointmentId')
        .getRawMany<{ appointmentId: string; vitalsCount: string }>(),
    ]);

    const billMap = new Map(bills.map((b) => [b.appointmentId, b]));
    const notesCountMap = new Map(
      notesCountRows.map((r) => [r.id, parseInt(r.notesCount, 10)]),
    );
    const vitalsCountMap = new Map(
      vitalsCountRows.map((r) => [r.appointmentId, parseInt(r.vitalsCount, 10)]),
    );

    for (const appt of appointments) {
      appt.patientBill = billMap.get(appt.id);
      if (appt.consultationId) {
        // Preserve any existing consultation data, add notesCount
        (appt as any).consultation = {
          ...(appt.consultation || {}),
          id: appt.consultationId,
          notesCount: notesCountMap.get(appt.consultationId) ?? 0,
        };
      }
      (appt as any).vitalsCount = vitalsCountMap.get(appt.id) ?? 0;
    }
  }

  /**
   * Get today's appointments with pagination
   */
  async getTodaysAppointments(
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedAppointmentResult> {
    const today = new Date().toISOString().split('T')[0];
    const query: QueryAppointmentsDto = {
      workspaceId,
      date: new Date(today),
      page,
      limit,
      sortBy: 'time',
      sortOrder: 'ASC',
    } as QueryAppointmentsDto;

    return this.searchAppointments(query);
  }

  /**
   * Get upcoming appointments with pagination
   */
  async getUpcomingAppointments(
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
    days: number = 7,
  ): Promise<PaginatedAppointmentResult> {
    const today = new Date();
    const futureDate = new Date();
    futureDate.setDate(today.getDate() + days);

    const query: QueryAppointmentsDto = {
      workspaceId,
      startDate: today.toISOString().split('T')[0],
      endDate: futureDate.toISOString().split('T')[0],
      page,
      limit,
      sortBy: 'date',
      sortOrder: 'ASC',
      status: AppointmentStatus.SCHEDULED,
    } as QueryAppointmentsDto;

    return this.searchAppointments(query);
  }

  /**
   * Get patient appointment history with pagination
   */
  async getPatientAppointmentHistory(
    workspaceId: string,
    patientId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedAppointmentResult> {
    const query: QueryAppointmentsDto = {
      workspaceId,
      patientId,
      page,
      limit,
      sortBy: 'date',
      sortOrder: 'DESC',
      includeCancelled: true,
    } as QueryAppointmentsDto;

    return this.searchAppointments(query);
  }

  /**
   * Identify sensitive fields for encryption.
   * O(1) Set lookup instead of O(N) array scan.
   */
  protected isSensitiveField(key: string): boolean {
    return AppointmentRepository.APPOINTMENT_SENSITIVE.has(key) || super.isSensitiveField(key);
  }
}
