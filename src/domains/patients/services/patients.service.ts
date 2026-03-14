import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import {
  CreatePatientDto,
  UpdatePatientDto,
  QueryPatientsDto,
  PatientResponseDto,
  PaginatedPatientsResponseDto,
  PatientListResponseDto,
} from '../dto';
import { Patient } from '../entities/patient.entity';
import {
  PatientRepository,
  PaginatedPatientResult,
} from '../repositories/patient.repository';
import { LoggerService } from '../../../common/logger/logger.service';
import { PatientInsurance } from 'src/domains/insurance/entities';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { AuditEventType, AuditOutcome } from '../../../common/enums';

// In-memory search index interface
interface PatientIndex {
  byId: Map<string, Patient>;
  byFileNumber: Map<string, Patient[]>;
  byPhone: Map<string, Patient[]>;
  byEmail: Map<string, Patient[]>;
  byNationalId: Map<string, Patient[]>;
  byFirstName: Map<string, Set<string>>;
  byLastName: Map<string, Set<string>>;
  byFullName: Map<string, Set<string>>;
  byCity: Map<string, Set<string>>;
  lastUpdated: Date;
  isBuilding: boolean;
  totalPatients: number;
}

@Injectable()
export class PatientsService implements OnModuleInit, OnModuleDestroy {
  private searchIndex!: PatientIndex;
  private indexRebuildInterval: NodeJS.Timeout | null = null;
  private readonly INDEX_REBUILD_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly INDEX_STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

  constructor(
    private readonly repository: PatientRepository,
    @Inject('PatientInsurance')
    private readonly patientInsuranceRepository: Repository<PatientInsurance>,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext('PatientsService');
    this.initializeIndex();
  }

  async onModuleInit() {
    this.logger.log('Initializing PatientsService');
    await this.rebuildSearchIndex();
    this.scheduleIndexRebuild();
  }

  onModuleDestroy() {
    if (this.indexRebuildInterval) {
      clearInterval(this.indexRebuildInterval);
      this.logger.log('Cleared index rebuild interval');
    }
  }

  /**
   * Initialize empty search index structure
   */
  private initializeIndex(): void {
    this.searchIndex = {
      byId: new Map(),
      byFileNumber: new Map(),
      byPhone: new Map(),
      byEmail: new Map(),
      byNationalId: new Map(),
      byFirstName: new Map(),
      byLastName: new Map(),
      byFullName: new Map(),
      byCity: new Map(),
      lastUpdated: new Date(),
      isBuilding: false,
      totalPatients: 0,
    };
  }

  /**
   * Schedule periodic index rebuilds
   */
  private scheduleIndexRebuild(): void {
    if (this.indexRebuildInterval) {
      clearInterval(this.indexRebuildInterval);
    }

    this.indexRebuildInterval = setInterval(async () => {
      try {
        await this.rebuildSearchIndex();
      } catch (error) {
        this.logger.error('Error rebuilding patient search index', error);
      }
    }, this.INDEX_REBUILD_INTERVAL_MS);
  }

  /**
   * Rebuild the entire search index
   */
  async rebuildSearchIndex(): Promise<void> {
    if (this.searchIndex.isBuilding) {
      this.logger.log('Index rebuild already in progress, skipping');
      return;
    }

    this.logger.log('Starting patient search index rebuild');
    const startTime = Date.now();
    this.searchIndex.isBuilding = true;

    try {
      const tempIndex: PatientIndex = {
        byId: new Map(),
        byFileNumber: new Map(),
        byPhone: new Map(),
        byEmail: new Map(),
        byNationalId: new Map(),
        byFirstName: new Map(),
        byLastName: new Map(),
        byFullName: new Map(),
        byCity: new Map(),
        lastUpdated: new Date(),
        isBuilding: false,
        totalPatients: 0,
      };

      // Use findPatientsForIndexing — no COUNT query per batch (saves
      // one SQL round-trip per batch). The old findWithPagination called
      // findAndCount which ran an extra COUNT(*) we never used.
      const batchSize = 1000;
      let offset = 0;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const batch = await this.repository.findPatientsForIndexing(
          offset,
          batchSize,
        );

        if (batch.length === 0) break;

        for (const patient of batch) {
          this.addPatientToIndex(patient, tempIndex);
        }

        offset += batchSize;
      }

      this.searchIndex = tempIndex;
      this.searchIndex.isBuilding = false;

      const duration = Date.now() - startTime;
      this.logger.log(
        `Patient search index rebuilt successfully. Indexed ${this.searchIndex.totalPatients} patients in ${duration}ms`,
      );
    } catch (error) {
      this.logger.error('Error rebuilding search index', error);
      this.searchIndex.isBuilding = false;
      throw error;
    }
  }

  /**
   * Add a single patient to the index
   */
  private addPatientToIndex(patient: Patient, index: PatientIndex): void {
    index.byId.set(patient.id, patient);

    const normalize = (val: string | null | undefined): string =>
      (val || '').toLowerCase().trim();

    const firstName = normalize(patient.firstName);
    const lastName = normalize(patient.lastName);
    const fileNumber = normalize(patient.fileNumber);
    const phone = normalize(patient.phoneNumber);
    const email = normalize(patient.email);
    const nationalId = normalize(patient.nationalId);
    const city = normalize(patient.city);

    // Index exact matches
    if (fileNumber) {
      if (!index.byFileNumber.has(fileNumber)) {
        index.byFileNumber.set(fileNumber, []);
      }
      index.byFileNumber.get(fileNumber)!.push(patient);
    }

    if (phone) {
      const normalizedPhone = phone.replace(/[\s\-\(\)]/g, '');
      if (!index.byPhone.has(normalizedPhone)) {
        index.byPhone.set(normalizedPhone, []);
      }
      index.byPhone.get(normalizedPhone)!.push(patient);
    }

    if (email) {
      if (!index.byEmail.has(email)) {
        index.byEmail.set(email, []);
      }
      index.byEmail.get(email)!.push(patient);
    }

    if (nationalId) {
      if (!index.byNationalId.has(nationalId)) {
        index.byNationalId.set(nationalId, []);
      }
      index.byNationalId.get(nationalId)!.push(patient);
    }

    // Index name tokens
    if (firstName) {
      this.addToTokenIndex(index.byFirstName, firstName, patient.id);
      for (let i = 2; i <= firstName.length; i++) {
        const prefix = firstName.substring(0, i);
        this.addToTokenIndex(index.byFirstName, prefix, patient.id);
      }
    }

    if (lastName) {
      this.addToTokenIndex(index.byLastName, lastName, patient.id);
      for (let i = 2; i <= lastName.length; i++) {
        const prefix = lastName.substring(0, i);
        this.addToTokenIndex(index.byLastName, prefix, patient.id);
      }
    }

    // Index full name combinations
    if (firstName && lastName) {
      const fullName = `${firstName} ${lastName}`;
      const fullNameReverse = `${lastName} ${firstName}`;
      const concatenated = `${firstName}${lastName}`;

      this.addToTokenIndex(index.byFullName, fullName, patient.id);
      this.addToTokenIndex(index.byFullName, fullNameReverse, patient.id);
      this.addToTokenIndex(index.byFullName, concatenated, patient.id);

      const words = fullName.split(/\s+/);
      words.forEach((word) => {
        if (word.length >= 2) {
          this.addToTokenIndex(index.byFullName, word, patient.id);
        }
      });
    }

    if (city) {
      this.addToTokenIndex(index.byCity, city, patient.id);
    }

    index.totalPatients++;
  }

  /**
   * Add patient ID to a token index
   */
  private addToTokenIndex(
    tokenIndex: Map<string, Set<string>>,
    token: string,
    patientId: string,
  ): void {
    if (!tokenIndex.has(token)) {
      tokenIndex.set(token, new Set());
    }
    tokenIndex.get(token)!.add(patientId);
  }

  /**
   * Remove patient from index
   */
  private removePatientFromIndex(patientId: string): void {
    const patient = this.searchIndex.byId.get(patientId);
    if (!patient) return;

    this.searchIndex.byId.delete(patientId);

    const normalize = (val: string | null | undefined): string =>
      (val || '').toLowerCase().trim();

    const removeFromList = (map: Map<string, Patient[]>, key: string) => {
      const list = map.get(key);
      if (list) {
        const filtered = list.filter((p) => p.id !== patientId);
        if (filtered.length > 0) {
          map.set(key, filtered);
        } else {
          map.delete(key);
        }
      }
    };

    removeFromList(
      this.searchIndex.byFileNumber,
      normalize(patient.fileNumber),
    );
    removeFromList(
      this.searchIndex.byPhone,
      normalize(patient.phoneNumber).replace(/[\s\-\(\)]/g, ''),
    );
    removeFromList(this.searchIndex.byEmail, normalize(patient.email));
    removeFromList(
      this.searchIndex.byNationalId,
      normalize(patient.nationalId),
    );

    this.searchIndex.totalPatients = Math.max(
      0,
      this.searchIndex.totalPatients - 1,
    );
  }

  /**
   * Update patient in index
   */
  private updatePatientInIndex(patient: Patient): void {
    this.removePatientFromIndex(patient.id);
    this.addPatientToIndex(patient, this.searchIndex);
  }

  /**
   * Format age object as human-readable string.
   * Single source of truth — avoids calling calculateAge twice
   * (once in getAgeString, once directly).
   */
  private formatAge(age: { years: number; months?: number }): string {
    if (age.years > 0) return `${age.years} year${age.years !== 1 ? 's' : ''}`;
    if (age.months !== undefined && age.months > 0)
      return `${age.months} month${age.months !== 1 ? 's' : ''}`;
    return 'Newborn';
  }

  /**
   * Check if index is stale
   */
  private isIndexStale(): boolean {
    const age = Date.now() - this.searchIndex.lastUpdated.getTime();
    return age > this.INDEX_STALE_THRESHOLD_MS;
  }

  /**
   * Create patient with optional insurance
   */
  async create(
    dto: CreatePatientDto,
    userId: string,
    workspaceId: string,
  ): Promise<PatientResponseDto> {
    this.logger.log('Creating new patient');

    try {
      const result = await this.dataSource.transaction(async (manager) => {
        // ✅ Idempotency: reject duplicate file number within this workspace.
        // fileNumber is encrypted with a random IV so a plain DB WHERE clause
        // cannot match it; instead we query the in-memory index (decrypted)
        // using the same normalisation used when the index was built.
        if (dto.fileNumber) {
          const normalized = dto.fileNumber.toLowerCase().trim();
          const existing = (this.searchIndex.byFileNumber.get(normalized) ?? [])
            .filter((p) => p.workspaceId === workspaceId);
          if (existing.length > 0) {
            throw new ConflictException(
              `A patient with file number '${dto.fileNumber}' already exists in this workspace`,
            );
          }
        }

        // Build the entity from the DTO, then encrypt sensitive fields via the
        // repository before persisting. manager.save() is a raw TypeORM call
        // that bypasses EncryptedRepository, so we handle encryption manually.
        const patient = manager.create(Patient, dto);
        await this.repository.encryptEntityFields(patient);
        const savedPatient = await manager.save(Patient, patient);

        this.logger.log(`Patient created with ID: ${savedPatient.id}`);

        if (dto.updatePatientInsurance && this.hasCompleteInsuranceData(dto)) {
          await this.createPatientInsurance(
            manager,
            savedPatient.id,
            dto.insuranceProviderId!,
            dto.schemeId!,
            (dto.insuranceMembershipNumber ?? dto.membershipNumber)!,
            dto.memberType || 'PRINCIPAL',
          );
          this.logger.log(`Insurance created for patient: ${savedPatient.id}`);
        }

        const patientWithRelations = await manager.findOne(Patient, {
          where: { id: savedPatient.id },
          relations: [
            'insurance',
            'insurance.insuranceProvider',
            'insurance.scheme',
          ],
        });

        // Decrypt the loaded entity for the in-memory index and response DTO —
        // manager.findOne() returns raw (encrypted) data from the database.
        await this.repository.decryptEntityFields(patientWithRelations);

        // Update search index
        this.addPatientToIndex(patientWithRelations!, this.searchIndex);

        return patientWithRelations;
      });

      // Audit log after successful creation (non-blocking)
      try {
        await this.auditLogService.log({
          userId,
          action: 'CREATE_PATIENT',
          eventType: AuditEventType.CREATE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'Patient',
          resourceId: result!.id,
          patientId: result!.id,
          justification: 'New patient registration',
          metadata: {
            firstName: result!.firstName,
            lastName: result!.lastName,
            gender: result!.gender,
            city: result!.city,
          },
        }, workspaceId);
      } catch (auditError) {
        this.logger.error('Failed to create audit log', auditError.stack);
      }

      return PatientResponseDto.fromEntity(result!);
    } catch (error) {
      // Audit log for failed creation
      try {
        await this.auditLogService.log({
          userId,
          action: 'CREATE_PATIENT',
          eventType: AuditEventType.CREATE,
          outcome: AuditOutcome.FAILURE,
          resourceType: 'Patient',
          justification: 'New patient registration',
          metadata: { error: error.message },
        }, workspaceId);
      } catch (auditError) {
        this.logger.error('Failed to create audit log', auditError.stack);
      }
      throw error;
    }
  }

  /**
   * Update patient with optional insurance update
   */
  async update(
    id: string,
    dto: UpdatePatientDto,
    userId: string,
    workspaceId: string,
  ): Promise<PatientResponseDto> {
    this.logger.log(`Updating patient: ${id}`);

    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const patient = await manager.findOne(Patient, {
          where: { id, workspaceId },
          relations: ['insurance'],
        });

        if (!patient) {
          throw new NotFoundException(`Patient with ID ${id} not found in workspace`);
        }

        // manager.findOne() returns raw (encrypted) DB values. Decrypt first so
        // that existing values used for audit logging are human-readable, and so
        // the DTO merge below works correctly (plaintext ?? plaintext).
        await this.repository.decryptEntityFields(patient);

        // Capture previous state for audit (now plaintext after decrypt above)
        const previousState = {
          firstName: patient.firstName,
          lastName: patient.lastName,
          gender: patient.gender,
          city: patient.city,
          isActive: patient.isActive,
        };

        // Merge DTO values (plaintext) onto the decrypted entity
        Object.assign(patient, {
          firstName: dto.firstName ?? patient.firstName,
          lastName: dto.lastName ?? patient.lastName,
          gender: dto.gender ?? patient.gender,
          birthDate: dto.birthDate ?? patient.birthDate,
          phoneNumber: dto.phoneNumber ?? patient.phoneNumber,
          email: dto.email ?? patient.email,
          address: dto.address ?? patient.address,
          city: dto.city ?? patient.city,
          nationalId: dto.nationalId ?? patient.nationalId,
          fileNumber: dto.fileNumber ?? patient.fileNumber,
          isActive: dto.isActive ?? patient.isActive,
        });

        // Encrypt sensitive fields before persisting via raw manager.save()
        await this.repository.encryptEntityFields(patient);
        await manager.save(Patient, patient);

        if (dto.updatePatientInsurance && this.hasCompleteInsuranceData(dto)) {
          await this.updateOrCreatePatientInsurance(
            manager,
            patient.id,
            dto.insuranceProviderId!,
            dto.schemeId!,
            (dto.insuranceMembershipNumber ?? dto.membershipNumber)!,
            dto.memberType || 'PRINCIPAL',
          );
          this.logger.log(`Insurance updated for patient: ${id}`);
        }

        const patientWithRelations = await manager.findOne(Patient, {
          where: { id: patient.id },
          relations: [
            'insurance',
            'insurance.insuranceProvider',
            'insurance.scheme',
          ],
        });

        // Decrypt the reloaded entity for the index and response DTO
        await this.repository.decryptEntityFields(patientWithRelations);

        // Update search index
        this.updatePatientInIndex(patientWithRelations!);

        this.logger.log(`Patient updated: ${id}`);
        return { patientWithRelations, previousState };
      });

      // Audit log after successful update (non-blocking)
      try {
        await this.auditLogService.log({
          userId,
          action: 'UPDATE_PATIENT',
          eventType: AuditEventType.UPDATE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'Patient',
          resourceId: id,
          patientId: id,
          previousState: result.previousState,
          newState: {
            firstName: result.patientWithRelations!.firstName,
            lastName: result.patientWithRelations!.lastName,
            gender: result.patientWithRelations!.gender,
            city: result.patientWithRelations!.city,
            isActive: result.patientWithRelations!.isActive,
          },
        }, workspaceId);
      } catch (auditError) {
        this.logger.error('Failed to create audit log', auditError.stack);
      }

      return PatientResponseDto.fromEntity(result.patientWithRelations!);
    } catch (error) {
      // Audit log for failed update
      try {
        await this.auditLogService.log({
          userId,
          action: 'UPDATE_PATIENT',
          eventType: AuditEventType.UPDATE,
          outcome: AuditOutcome.FAILURE,
          resourceType: 'Patient',
          resourceId: id,
          patientId: id,
          metadata: { error: error.message },
        }, workspaceId);
      } catch (auditError) {
        this.logger.error('Failed to create audit log', auditError.stack);
      }
      throw error;
    }
  }

  /**
   * Create patient insurance
   */
  private async createPatientInsurance(
    manager: any,
    patientId: string,
    insuranceProviderId: string,
    schemeId: string,
    membershipNumber: string,
    memberType: 'PRINCIPAL' | 'DEPENDENT',
  ): Promise<any> {
    const now = new Date();
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

    const insurance = manager.create('PatientInsurance', {
      patientId,
      insuranceProviderId,
      schemeId,
      membershipNumber,
      memberType,
      status: 'ACTIVE',
      isPrimary: true,
      priority: 1,
      effectiveDate: now,
      expiryDate: oneYearFromNow,
      enrollmentDate: now,
    });

    return await manager.save('PatientInsurance', insurance);
  }

  /**
   * Update or create patient insurance
   */
  private async updateOrCreatePatientInsurance(
    manager: any,
    patientId: string,
    insuranceProviderId: string,
    schemeId: string,
    membershipNumber: string,
    memberType: 'PRINCIPAL' | 'DEPENDENT',
  ): Promise<any> {
    let insurance = await manager.findOne('PatientInsurance', {
      where: { patientId },
    });

    const now = new Date();
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

    if (insurance) {
      insurance.insuranceProviderId = insuranceProviderId;
      insurance.schemeId = schemeId;
      insurance.membershipNumber = membershipNumber;
      insurance.memberType = memberType;
      insurance.status = 'ACTIVE';
      insurance.updatedAt = now;

      return await manager.save('PatientInsurance', insurance);
    } else {
      return await this.createPatientInsurance(
        manager,
        patientId,
        insuranceProviderId,
        schemeId,
        membershipNumber,
        memberType,
      );
    }
  }

  /**
   * Check if DTO has complete insurance data
   */
  private hasCompleteInsuranceData(
    dto: CreatePatientDto | UpdatePatientDto,
  ): boolean {
    return !!(dto.insuranceProviderId && dto.schemeId && (dto.insuranceMembershipNumber ?? dto.membershipNumber));
  }

  /**
   * Find all patients with search and pagination
   */
  async findAll(
    query: QueryPatientsDto,
  ): Promise<PaginatedPatientsResponseDto> {
    this.logger.log('Finding all patients with query');

    // Trigger rebuild if stale
    if (this.isIndexStale() && !this.searchIndex.isBuilding) {
      this.rebuildSearchIndex().catch((err) =>
        this.logger.error('Background index rebuild failed', err),
      );
    }

    let searchResult: PaginatedPatientResult;

    if (query.search?.trim()) {
      searchResult = await this.searchIndexed(
        query,
        query.page || 1,
        query.limit || 10,
      );
    } else {
      searchResult = await this.searchStandard(query);
    }

    return {
      data: searchResult.data.map((patient) => {
        const dto = PatientResponseDto.fromEntity(patient);
        const ageData = this.repository.calculateAge(patient);
        return {
          ...dto,
          age: this.formatAge(ageData),
          ageA: ageData,
        };
      }),
      meta: searchResult.meta,
    };
  }

  /**
   * Search using in-memory index.
   *
   * Relevance-tier sort (two buckets, stable within each):
   *   Tier 0 — "exact/substring" matches:
   *     • byFileNumber / byEmail / byNationalId / byPhone exact-key lookups
   *     • Any patient whose firstName, lastName, or full name contains the
   *       search term as a direct substring (e.g. "zhanje" inside "anna zhanje")
   *   Tier 1 — prefix-only matches:
   *     • Patients reached solely via byFirstName/byLastName prefix tokens
   *       (e.g. "zh" prefix matching "ZHANDIRE" via the trie)
   *
   * Within each tier the user's sortBy/sortOrder (default: createdAt DESC) is
   * preserved — Array.sort is stable in V8/Node ≥ 11.
   *
   * Big-O: O(1) per index lookup + O(M log M) sort, M = matched patients.
   * No cap required: the index is pre-decrypted, no SQL IN clause, no DB round-trips.
   */
  private async searchIndexed(
    query: QueryPatientsDto,
    page: number,
    limit: number,
  ): Promise<PaginatedPatientResult> {
    const startTime = Date.now();
    const searchTerm = query.search!.trim().toLowerCase();
    const matchedPatientIds = new Set<string>();
    // Tier-0 IDs: found via exact-field lookups or direct substring in name
    const exactMatchIds = new Set<string>();

    // ── Exact-field lookups (always Tier 0) ──────────────────────────────
    const fileNumberMatches =
      this.searchIndex.byFileNumber.get(searchTerm) || [];
    fileNumberMatches.forEach((p) => {
      matchedPatientIds.add(p.id);
      exactMatchIds.add(p.id);
    });

    const emailMatches = this.searchIndex.byEmail.get(searchTerm) || [];
    emailMatches.forEach((p) => {
      matchedPatientIds.add(p.id);
      exactMatchIds.add(p.id);
    });

    const nationalIdMatches =
      this.searchIndex.byNationalId.get(searchTerm) || [];
    nationalIdMatches.forEach((p) => {
      matchedPatientIds.add(p.id);
      exactMatchIds.add(p.id);
    });

    // Phone match
    if (searchTerm.match(/[\d]/)) {
      const normalizedPhone = searchTerm.replace(/[\s\-\(\)]/g, '');
      const phoneMatches = this.searchIndex.byPhone.get(normalizedPhone) || [];
      phoneMatches.forEach((p) => {
        matchedPatientIds.add(p.id);
        exactMatchIds.add(p.id);
      });
    }

    // ── Name / token matches (Tier 0 or Tier 1 — classified below) ───────
    const fullNameMatches =
      this.searchIndex.byFullName.get(searchTerm) || new Set();
    fullNameMatches.forEach((id) => matchedPatientIds.add(id));

    const firstNameMatches =
      this.searchIndex.byFirstName.get(searchTerm) || new Set();
    firstNameMatches.forEach((id) => matchedPatientIds.add(id));

    const lastNameMatches =
      this.searchIndex.byLastName.get(searchTerm) || new Set();
    lastNameMatches.forEach((id) => matchedPatientIds.add(id));

    // Multi-word search
    const searchWords = searchTerm.split(/\s+/).filter((w) => w.length > 0);
    if (searchWords.length > 1) {
      const wordMatchSets = searchWords.map((word) => {
        const matches = new Set<string>();
        (this.searchIndex.byFullName.get(word) || new Set()).forEach((id) =>
          matches.add(id),
        );
        (this.searchIndex.byFirstName.get(word) || new Set()).forEach((id) =>
          matches.add(id),
        );
        (this.searchIndex.byLastName.get(word) || new Set()).forEach((id) =>
          matches.add(id),
        );
        return matches;
      });

      if (wordMatchSets.length > 0) {
        let intersection = wordMatchSets[0];
        for (let i = 1; i < wordMatchSets.length; i++) {
          intersection = new Set(
            Array.from(intersection).filter((id) => wordMatchSets[i].has(id)),
          );
        }
        intersection.forEach((id) => matchedPatientIds.add(id));
      }
    }

    // Get matched patients — filter by workspaceId for multi-tenancy isolation
    const wsId = query.workspaceId;
    const matchedPatients = Array.from(matchedPatientIds)
      .map((id) => this.searchIndex.byId.get(id))
      .filter((p): p is Patient => p !== undefined && (!wsId || p.workspaceId === wsId));

    // ── Classify name-matched patients into Tier 0 if searchTerm is a
    //    direct substring of their name (not just a trie-prefix hit). ─────
    // O(M × constant): no extra allocations, index already holds plaintext.
    for (const patient of matchedPatients) {
      if (exactMatchIds.has(patient.id)) continue; // already Tier 0
      const fn = (patient.firstName || '').toLowerCase();
      const ln = (patient.lastName || '').toLowerCase();
      if (
        fn.includes(searchTerm) ||
        ln.includes(searchTerm) ||
        `${fn} ${ln}`.includes(searchTerm)
      ) {
        exactMatchIds.add(patient.id);
      }
    }

    // Apply filters
    let filteredPatients = this.applyFilters(matchedPatients, query);

    // Apply user-preferred sort (date/name) as secondary key within each tier
    filteredPatients = this.applySorting(filteredPatients, query);

    // Stable relevance-tier promotion: Tier-0 (exact/substring) floats to
    // the top. Array.sort is stable in Node ≥ 11, so date order is preserved
    // within each tier.
    if (exactMatchIds.size > 0 && exactMatchIds.size < matchedPatientIds.size) {
      filteredPatients.sort((a, b) => {
        const aRank = exactMatchIds.has(a.id) ? 0 : 1;
        const bRank = exactMatchIds.has(b.id) ? 0 : 1;
        return aRank - bRank; // 0 = same tier → stable (preserves date order)
      });
    }

    const total = filteredPatients.length;
    const startIndex = (page - 1) * limit;
    const paginatedResults = filteredPatients.slice(
      startIndex,
      startIndex + limit,
    );

    // Attach insurance + active-appointment status for the displayed page
    // so search results include the same medical details as the standard list.
    await this.repository.attachMedicalDetails(paginatedResults);

    const executionTime = Date.now() - startTime;

    return {
      data: paginatedResults,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      searchMetadata: {
        searchTerm,
        searchMethod: 'indexed',
        executionTime,
        cacheHit: true,
      },
    };
  }

  /**
   * Standard database search
   */
  private async searchStandard(
    query: QueryPatientsDto,
  ): Promise<PaginatedPatientResult> {
    const startTime = Date.now();
    const page = query.page || 1;
    const limit = query.limit || 10;

    const filters = {
      workspaceId: query.workspaceId!,
      isActive: query.isActive,
      gender: query.gender,
      city: query.city,
      appointmentStatus: query.appointmentStatus,
      hasActiveAppointments: query.hasActiveAppointments,
    };

    const [patients, total] = await this.repository.findPatientsWithFilters(
      filters,
      page,
      limit,
    );

    const executionTime = Date.now() - startTime;

    return {
      data: patients,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      searchMetadata: {
        searchTerm: '',
        searchMethod: 'standard',
        executionTime,
        cacheHit: false,
      },
    };
  }

  /**
   * Apply filters to patient list
   */
  private applyFilters(
    patients: Patient[],
    query: QueryPatientsDto,
  ): Patient[] {
    let filtered = patients;

    if (query.isActive !== undefined) {
      filtered = filtered.filter((p) => p.isActive === query.isActive);
    }

    if (query.gender) {
      filtered = filtered.filter(
        (p) => p.gender?.toLowerCase() === query.gender?.toLowerCase(),
      );
    }

    if (query.city) {
      filtered = filtered.filter((p) =>
        p.city?.toLowerCase().includes(query.city!.toLowerCase()),
      );
    }

    return filtered;
  }

  /**
   * Apply sorting to patient list
   */
  private applySorting(
    patients: Patient[],
    query: QueryPatientsDto,
  ): Patient[] {
    const sortField = query.sortBy || 'createdAt';
    const sortDirection = query.sortOrder || 'DESC';

    return patients.sort((a, b) => {
      let aValue: any = a[sortField as keyof Patient];
      let bValue: any = b[sortField as keyof Patient];

      if (aValue == null) aValue = '';
      if (bValue == null) bValue = '';

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        const comparison = aValue.localeCompare(bValue, undefined, {
          sensitivity: 'base',
        });
        return sortDirection === 'ASC' ? comparison : -comparison;
      }

      if (aValue < bValue) return sortDirection === 'ASC' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'ASC' ? 1 : -1;
      return 0;
    });
  }

  /**
   * Find one patient by ID
   */
  async findOne(
    id: string,
    userId: string,
    workspaceId: string,
  ): Promise<PatientResponseDto> {
    this.logger.log(`Finding patient: ${id} in workspace: ${workspaceId}`);

    const patient = await this.repository.findByIdWithRelations(id, workspaceId);
    if (!patient) {
      throw new NotFoundException(`Patient with ID ${id} not found`);
    }

    // Audit log for patient access (HIPAA requirement) - non-blocking
    try {
      await this.auditLogService.log({
        userId,
        action: 'VIEW_PATIENT',
        eventType: AuditEventType.READ,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'Patient',
        resourceId: id,
        patientId: id,
        justification: 'Patient record access',
      }, workspaceId);
    } catch (auditError) {
      this.logger.error('Failed to create audit log', auditError.stack);
    }

    const dto = PatientResponseDto.fromEntity(patient);
    const ageData = this.repository.calculateAge(patient);
    return {
      ...dto,
      age: this.formatAge(ageData),
    };
  }

  /**
   * Soft delete patient
   */
  async remove(
    id: string,
    deletedById: string,
    workspaceId: string,
  ): Promise<PatientResponseDto> {
    this.logger.log(`Soft deleting patient: ${id} in workspace: ${workspaceId}`);

    try {
      const patient = await this.repository.findById(id, workspaceId);
      if (!patient) {
        throw new NotFoundException(`Patient with ID ${id} not found`);
      }

      patient.deletedById = deletedById;
      patient.isActive = false;
      await this.repository.save(patient);

      const result = await this.repository.softDelete(id);
      if (result.affected === 0) {
        throw new NotFoundException(`Patient with ID ${id} not found`);
      }

      // Remove from index
      this.removePatientFromIndex(id);

      this.logger.log(`Patient soft deleted: ${id}`);

      // Audit log for deletion (non-blocking)
      try {
        await this.auditLogService.log({
          userId: deletedById,
          action: 'DELETE_PATIENT',
          eventType: AuditEventType.DELETE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'Patient',
          resourceId: id,
          patientId: id,
        }, workspaceId);
      } catch (auditError) {
        this.logger.error('Failed to create audit log', auditError.stack);
      }

      // Return DTO instead of entity
      return PatientResponseDto.fromEntity(patient);
    } catch (error) {
      // Audit log for failed deletion
      try {
        await this.auditLogService.log({
          userId: deletedById,
          action: 'DELETE_PATIENT',
          eventType: AuditEventType.DELETE,
          outcome: AuditOutcome.FAILURE,
          resourceType: 'Patient',
          resourceId: id,
          patientId: id,
          metadata: { error: error.message },
        }, workspaceId);
      } catch (auditError) {
        this.logger.error('Failed to create audit log', auditError.stack);
      }
      throw error;
    }
  }

  /**
   * Search by file number — O(1) in-memory index lookup.
   *
   * Previous: O(N) full-table scan + decrypt every row via
   *   repository.searchByEncryptedField (base class batch decrypt).
   * Now: O(1) hash-map lookup from the pre-built in-memory index.
   */
  async findByFileNumber(
    fileNumber: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedPatientsResponseDto> {
    this.logger.log(`Searching by file number: ${fileNumber} in workspace: ${workspaceId}`);

    const normalized = fileNumber.toLowerCase().trim();
    const allMatches = this.searchIndex.byFileNumber.get(normalized) || [];
    const matches = allMatches.filter((p) => p.workspaceId === workspaceId);
    const total = matches.length;
    const startIndex = (page - 1) * limit;
    const paginatedResults = matches.slice(startIndex, startIndex + limit);

    // Attach insurance + active-appointment status for the displayed page
    await this.repository.attachMedicalDetails(paginatedResults);

    return {
      data: paginatedResults.map((patient) => {
        const dto = PatientResponseDto.fromEntity(patient);
        const ageData = this.repository.calculateAge(patient);
        return { ...dto, age: this.formatAge(ageData), ageA: ageData };
      }),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Search by phone — O(1) in-memory index lookup.
   *
   * Previous: O(N) full-table scan + decrypt every row.
   * Now: O(1) hash-map lookup with the same phone normalisation
   *   (strip spaces / dashes / parens) used when the index was built.
   */
  async findByPhone(
    phoneNumber: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedPatientsResponseDto> {
    this.logger.log(`Searching by phone: ${phoneNumber} in workspace: ${workspaceId}`);

    const normalizedPhone = phoneNumber
      .toLowerCase()
      .trim()
      .replace(/[\s\-\(\)]/g, '');
    const allMatches = this.searchIndex.byPhone.get(normalizedPhone) || [];
    const matches = allMatches.filter((p) => p.workspaceId === workspaceId);
    const total = matches.length;
    const startIndex = (page - 1) * limit;
    const paginatedResults = matches.slice(startIndex, startIndex + limit);

    // Attach insurance + active-appointment status for the displayed page
    await this.repository.attachMedicalDetails(paginatedResults);

    return {
      data: paginatedResults.map((patient) => {
        const dto = PatientResponseDto.fromEntity(patient);
        const ageData = this.repository.calculateAge(patient);
        return { ...dto, age: this.formatAge(ageData), ageA: ageData };
      }),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Search by name
   */
  async findByName(
    workspaceId: string,
    name: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedPatientsResponseDto> {
    this.logger.log(`Searching by name: ${name} in workspace: ${workspaceId}`);

    return this.findAll({
      workspaceId,
      search: name,
      page,
      limit,
      sortBy: 'createdAt',
      sortOrder: 'DESC',
    });
  }

  /**
   * Get search suggestions
   */
  async getSearchSuggestions(
    partialTerm: string,
    workspaceId: string,
    limit: number = 10,
  ): Promise<string[]> {
    if (!partialTerm || partialTerm.length < 2) return [];

    const normalized = partialTerm.toLowerCase().trim();
    const suggestions = new Set<string>();

    const nameMatches =
      this.searchIndex.byFullName.get(normalized) || new Set();
    nameMatches.forEach((id) => {
      const patient = this.searchIndex.byId.get(id);
      if (patient && patient.workspaceId === workspaceId && suggestions.size < limit) {
        const fullName = `${patient.firstName} ${patient.lastName}`.trim();
        if (fullName) suggestions.add(fullName);
        if (patient.fileNumber && suggestions.size < limit) {
          suggestions.add(patient.fileNumber);
        }
      }
    });

    return Array.from(suggestions).slice(0, limit);
  }

  /**
   * Advanced search — operates entirely on the in-memory index.
   *
   * Previous: called findAll with limit:10000, which converted ALL matched
   *   patients to DTOs (10K × fromEntity + 10K × getAgeString + 10K ×
   *   calculateAge), THEN post-filtered by age, THEN re-paginated.
   *   Complexity: O(10000 × DTO) even if only 10 results displayed.
   *
   * Now: filters raw Patient entities from the index, paginates, and
   *   converts ONLY the displayed page (typically 10) to DTOs.
   *   Complexity: O(N_matched) for filtering + O(limit) for DTO conversion.
   */
  async advancedSearch(
    workspaceId: string,
    criteria: {
      name?: string;
      fileNumber?: string;
      phone?: string;
      city?: string;
      ageRange?: { min: number; max: number };
      gender?: 'MALE' | 'FEMALE' | 'OTHER' | 'UNSPECIFIED';
    },
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedPatientsResponseDto> {
    this.logger.log(`Performing advanced search in workspace: ${workspaceId}`);

    const searchTerms: string[] = [];
    if (criteria.name) searchTerms.push(criteria.name);
    if (criteria.fileNumber) searchTerms.push(criteria.fileNumber);
    if (criteria.phone) searchTerms.push(criteria.phone);

    // ── Step 1: collect candidate Patient entities (no DTO conversion) ──
    let candidates: Patient[];

    if (searchTerms.length > 0) {
      // Use the in-memory index for text search — fetch all matches
      const idxResult = await this.searchIndexed(
        {
          workspaceId,
          search: searchTerms.join(' '),
          city: criteria.city,
          gender: criteria.gender,
        } as QueryPatientsDto,
        1,
        this.searchIndex.totalPatients || 100_000,
      );
      candidates = idxResult.data;
    } else {
      // No text search — start with all indexed patients scoped to workspace
      candidates = Array.from(this.searchIndex.byId.values())
        .filter((p) => p.workspaceId === workspaceId);
      candidates = this.applyFilters(candidates, {
        city: criteria.city,
        gender: criteria.gender,
      } as QueryPatientsDto);
    }

    // ── Step 2: apply age-range filter on entities (cheap) ──
    if (criteria.ageRange) {
      candidates = candidates.filter((patient) => {
        const { years } = this.repository.calculateAge(patient);
        return (
          years >= criteria.ageRange!.min && years <= criteria.ageRange!.max
        );
      });
    }

    // ── Step 3: paginate THEN convert to DTOs (only for displayed page) ──
    const total = candidates.length;
    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const paginatedResults = candidates.slice(startIndex, startIndex + limit);

    // Attach insurance + active-appointment status for the displayed page
    await this.repository.attachMedicalDetails(paginatedResults);

    return {
      data: paginatedResults.map((patient) => {
        const dto = PatientResponseDto.fromEntity(patient);
        const ageData = this.repository.calculateAge(patient);
        return { ...dto, age: this.formatAge(ageData), ageA: ageData };
      }),
      meta: { total, page, limit, totalPages },
    };
  }

  /**
   * Bulk update
   */
  async bulkUpdate(
    updates: Array<{ id: string } & Partial<UpdatePatientDto>>,
    workspaceId: string,
  ): Promise<PatientListResponseDto[]> {
    this.logger.log(`Bulk updating ${updates.length} patients in workspace: ${workspaceId}`);

    // Ensure all updates are scoped to the current workspace
    const scopedUpdates = updates.map((u) => ({ ...u, workspaceId }));
    const patients = await this.repository.bulkSave(scopedUpdates);
    return patients.map((patient) => PatientResponseDto.fromEntity(patient));
  }

  /**
   * Legacy methods for backward compatibility
   */
  async findByFileNumberLegacy(
    fileNumber: string,
    workspaceId: string,
  ): Promise<PatientListResponseDto[]> {
    const result = await this.findByFileNumber(fileNumber, workspaceId, 1, 50);
    return result.data;
  }

  async findByPhoneLegacy(
    phoneNumber: string,
    workspaceId: string,
  ): Promise<PatientListResponseDto[]> {
    const result = await this.findByPhone(phoneNumber, workspaceId, 1, 50);
    return result.data;
  }

  async findByNameLegacy(
    workspaceId: string,
    name: string,
  ): Promise<PatientListResponseDto[]> {
    const result = await this.findByName(workspaceId, name, 1, 50);
    return result.data;
  }

  async advancedSearchLegacy(
    workspaceId: string,
    criteria: {
      name?: string;
      fileNumber?: string;
      phone?: string;
      city?: string;
      ageRange?: { min: number; max: number };
      gender?: 'MALE' | 'FEMALE' | 'OTHER' | 'UNSPECIFIED';
    },
  ): Promise<PatientListResponseDto[]> {
    const result = await this.advancedSearch(workspaceId, criteria, 1, 100);
    return result.data;
  }

  /**
   * Search with metadata
   */
  async searchWithMetadata(
    query: QueryPatientsDto,
  ): Promise<PaginatedPatientsResponseDto & { searchMetadata?: any }> {
    const searchResult = await this.findAll(query);
    return {
      ...searchResult,
      searchMetadata: {
        indexStats: this.getIndexStats(),
      },
    };
  }

  /**
   * Get index statistics
   */
  getIndexStats(): {
    totalPatients: number;
    lastUpdated: Date;
    isBuilding: boolean;
    indexSize: {
      byId: number;
      byFileNumber: number;
      byPhone: number;
      byEmail: number;
      byFullName: number;
    };
  } {
    return {
      totalPatients: this.searchIndex.totalPatients,
      lastUpdated: this.searchIndex.lastUpdated,
      isBuilding: this.searchIndex.isBuilding,
      indexSize: {
        byId: this.searchIndex.byId.size,
        byFileNumber: this.searchIndex.byFileNumber.size,
        byPhone: this.searchIndex.byPhone.size,
        byEmail: this.searchIndex.byEmail.size,
        byFullName: this.searchIndex.byFullName.size,
      },
    };
  }

  /**
   * Manual index invalidation
   */
  async invalidateSearchIndex(): Promise<void> {
    this.logger.log('Manually invalidating search index');
    await this.rebuildSearchIndex();
  }
}
