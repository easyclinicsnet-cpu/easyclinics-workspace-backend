import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere } from 'typeorm';
import { Patient } from '../entities/patient.entity';
import { PatientInsurance } from '../../insurance/entities';
import { Appointment } from '../../appointments/entities/appointment.entity';
import { AppointmentStatus } from '../../../common/enums';
import { LoggerService } from '../../../common/logger/logger.service';
import { Aes256Service } from '../../../common/security/encryption/aes-256.service';
import { EncryptedRepository } from '../../../common/database/repositories/encrypted-repository.base';

export interface PaginatedPatientResult {
  data: Patient[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  searchMetadata?: {
    searchTerm: string;
    searchMethod: 'encrypted' | 'standard' | 'indexed';
    executionTime: number;
    cacheHit: boolean;
  };
}

@Injectable()
export class PatientRepository extends EncryptedRepository<Patient> {
  constructor(
    dataSource: DataSource,
    aesService: Aes256Service,
    logger: LoggerService,
  ) {
    super(Patient, dataSource, aesService, logger);
    this.logger.setContext('PatientRepository');
  }

  // O(1) Set lookup for all patient PHI fields that must be encrypted.
  // The base class KNOWN_SENSITIVE covers firstName, lastName, email,
  // address, nationalId — but misses gender, birthDate, phoneNumber,
  // membershipNumber, medicalAid, and city.
  private static readonly PATIENT_SENSITIVE = new Set([
    'firstName',
    'lastName',
    'gender',
    'birthDate',
    'phoneNumber',
    'medicalAid',
    'membershipNumber',
    'email',
    'city',
    'address',
    'nationalId',
    'fileNumber',
  ]);

  /**
   * Identify sensitive fields for encryption.
   * Patient PHI fields + any fields the parent considers sensitive.
   */
  protected isSensitiveField(key: string): boolean {
    return PatientRepository.PATIENT_SENSITIVE.has(key) || super.isSensitiveField(key);
  }

  /**
   * Define searchable encrypted fields for the base repository
   * These fields will be used for encrypted field search
   */
  protected getSearchableEncryptedFields(): string[] {
    return [
      'firstName',
      'lastName',
      'email',
      'phoneNumber',
      'nationalId',
      'fileNumber',
      'address',
      'city',
    ];
  }

  /**
   * Define default search filters for the base repository
   * Applied to all searches to ensure multi-tenancy and active status
   */
  protected getSearchFilters(): Partial<FindOptionsWhere<Patient>> {
    return {
      isActive: true,
    } as Partial<FindOptionsWhere<Patient>>;
  }

  // ===== BUSINESS LOGIC HELPER METHODS (Moved from Patient Entity) =====
  // Note: Encryption/decryption is now handled by EncryptedRepository base class

  /**
   * Calculate patient's age from birth date
   * @param patient Patient entity
   * @returns Age object with years and optional months
   */
  calculateAge(patient: Patient): { years: number; months?: number } {
    if (!patient.birthDate || isNaN(Date.parse(patient.birthDate))) {
      return { years: 0 };
    }

    try {
      const birthDate = new Date(patient.birthDate);
      const today = new Date();

      if (isNaN(birthDate.getTime())) {
        return { years: 0 };
      }

      let years = today.getFullYear() - birthDate.getFullYear();
      let months = today.getMonth() - birthDate.getMonth();

      if (today.getDate() < birthDate.getDate()) {
        months--;
      }

      if (months < 0) {
        years--;
        months += 12;
      }

      return years > 0 ? { years } : { years: 0, months };
    } catch (error) {
      this.logger.error('Error calculating age:', error);
      return { years: 0 };
    }
  }

  /**
   * Get age as a formatted string
   * @param patient Patient entity
   * @returns Formatted age string (e.g., "33 years", "5 months", "Newborn")
   */
  getAgeString(patient: Patient): string {
    try {
      const age = this.calculateAge(patient);
      if (age.years > 0) {
        return `${age.years} year${age.years !== 1 ? 's' : ''}`;
      } else if (age.months !== undefined && age.months > 0) {
        return `${age.months} month${age.months !== 1 ? 's' : ''}`;
      }
      return 'Newborn';
    } catch (error) {
      this.logger.error('Error getting age string:', error);
      return 'Age unknown';
    }
  }

  /**
   * Get patient's full name
   * @param patient Patient entity
   * @returns Full name (firstName + lastName)
   */
  getFullName(patient: Patient): string {
    return `${patient.firstName || ''} ${patient.lastName || ''}`.trim();
  }

  /**
   * Get formatted gender
   * @param patient Patient entity
   * @returns Capitalized gender string
   */
  getFormattedGender(patient: Patient): string {
    if (!patient.gender) return 'Unknown';
    return patient.gender.charAt(0).toUpperCase() + patient.gender.slice(1).toLowerCase();
  }

  /**
   * Check if patient is active
   * @param patient Patient entity
   * @returns Boolean indicating if patient is active
   */
  isActivePatient(patient: Patient): boolean {
    return patient.isActive === true;
  }

  /**
   * Get active sick notes for patient
   * @param patient Patient entity with sickNotes relation loaded
   * @returns Array of active sick notes
   */
  getActiveSickNotes(patient: Patient): any[] {
    if (!patient.sickNotes) return [];
    return patient.sickNotes.filter((note: any) => note.isActive);
  }

  /**
   * Get recent referral letters for patient
   * @param patient Patient entity with referralLetters relation loaded
   * @param limit Maximum number of referrals to return
   * @returns Array of recent active referral letters
   */
  getRecentReferrals(patient: Patient, limit: number = 5): any[] {
    if (!patient.referralLetters) return [];
    return patient.referralLetters
      .filter((ref: any) => ref.isActive)
      .sort(
        (a: any, b: any) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, limit);
  }

  /**
   * Mark patient insurance as migrated
   * @param patient Patient entity (will be modified)
   */
  markInsuranceMigrated(patient: Patient): void {
    patient.insuranceMigrated = true;
    patient.insuranceMigratedAt = new Date();
  }

  /**
   * Check if patient insurance has been migrated
   * @param patient Patient entity
   * @returns Boolean indicating if insurance is migrated
   */
  hasInsuranceMigrated(patient: Patient): boolean {
    return patient.insuranceMigrated === true;
  }

  /**
   * Find patient by ID with relations
   * Note: Decryption is handled automatically by the base EncryptedRepository
   */
  async findByIdWithRelations(id: string, workspaceId: string): Promise<Patient | null> {
    this.logger.log(`Finding patient by ID with relations: ${id} in workspace: ${workspaceId}`);

    try {
      const patient = await this.createQueryBuilder('patient')
        .leftJoinAndSelect('patient.appointments', 'appointment')
        .leftJoinAndSelect('patient.consultations', 'consultation')
        .leftJoinAndSelect('patient.allergies', 'allergy')
        .leftJoinAndSelect('patient.familyConditions', 'familyCondition')
        .leftJoinAndSelect('patient.socialHistories', 'socialHistory')
        .leftJoinAndSelect('patient.medicalHistory', 'medicalHistory')
        .leftJoinAndSelect('patient.surgicalHistory', 'surgicalHistory')
        .leftJoinAndSelect('patient.insurance', 'insurance')
        .leftJoinAndSelect('insurance.insuranceProvider', 'provider')
        .leftJoinAndSelect('insurance.scheme', 'scheme')
        .where('patient.id = :id', { id })
        .andWhere('patient.workspaceId = :workspaceId', { workspaceId })
        .getOne();

      if (patient) {
        await this.decryptEntityFields(patient);
        return this.ensureEntityMethods(patient);
      }
      return null;
    } catch (error) {
      this.logger.error(`Error finding patient by ID: ${id}`, error);
      throw error;
    }
  }

  /**
   * Find patient by ID (simple)
   * Note: Decryption is handled automatically by the base EncryptedRepository
   */
  async findById(id: string, workspaceId: string): Promise<Patient | null> {
    this.logger.log(`Finding patient by ID: ${id} in workspace: ${workspaceId}`);

    try {
      // Base class findOneBy handles decryption automatically
      const patient = await this.findOneBy({ id, workspaceId } as FindOptionsWhere<Patient>);
      return patient;
    } catch (error) {
      this.logger.error(`Error finding patient: ${id}`, error);
      throw error;
    }
  }

  /**
   * Find patients with pagination and filters
   * Note: Decryption is handled automatically by the base EncryptedRepository
   */
  async findWithPagination(
    page: number = 1,
    limit: number = 10,
    workspaceId: string,
    where?: Partial<FindOptionsWhere<Patient>>,
  ): Promise<PaginatedPatientResult> {
    this.logger.log(`Finding patients with pagination - page: ${page}, limit: ${limit}, workspace: ${workspaceId}`);

    const startTime = Date.now();

    try {
      // Base class findAndCount handles decryption automatically
      const [patients, total] = await this.findAndCount({
        where: { isActive: true, workspaceId, ...where },
        skip: (page - 1) * limit,
        take: limit,
        order: { createdAt: 'DESC' },
      });

      const totalPages = Math.ceil(total / limit);
      const executionTime = Date.now() - startTime;

      this.logger.log(`Found ${total} patients in ${executionTime}ms`);

      return {
        data: patients,
        meta: {
          total,
          page,
          limit,
          totalPages,
        },
        searchMetadata: {
          searchTerm: '',
          searchMethod: 'standard',
          executionTime,
          cacheHit: false,
        },
      };
    } catch (error) {
      this.logger.error('Error finding patients with pagination', error);
      throw error;
    }
  }

  /**
   * Find patients with filters — optimised for list view.
   *
   * Strategy (3 lightweight queries instead of 1 heavy JOIN):
   *  1. COUNT on patients table only — no JOINs, hits idx_patients_is_active.
   *  2. SELECT patients with LIMIT — no JOINs, fast paginated fetch.
   *  3. SELECT insurance WHERE patientId IN (…10 ids…) — tiny batch for the
   *     displayed page only, with provider + scheme JOINs (max 10 rows).
   *
   * Why: the previous approach ran COUNT(*) over a 3-table JOIN (patients ×
   * insurance × provider × scheme) which forced MySQL to scan the full
   * joined result set. Splitting into 3 simple queries is dramatically faster.
   */
  async findPatientsWithFilters(
    filters: {
      workspaceId: string;
      isActive?: boolean;
      gender?: string;
      city?: string;
      appointmentStatus?: string[];
      hasActiveAppointments?: boolean;
    },
    page: number,
    limit: number,
  ): Promise<[Patient[], number]> {
    try {
      // ── Query 1+2: patients only (no insurance JOINs → fast COUNT) ──
      const qb = this.createQueryBuilder('patient');

      const needsAppointmentJoin =
        (filters.appointmentStatus && filters.appointmentStatus.length > 0) ||
        filters.hasActiveAppointments !== undefined;

      if (needsAppointmentJoin) {
        qb.leftJoin('patient.appointments', 'appointment');
      }

      // ── Multi-tenancy: always scope by workspace ──
      qb.andWhere('patient.workspaceId = :workspaceId', {
        workspaceId: filters.workspaceId,
      });

      // Only filter by isActive when explicitly provided; omitting it returns all patients (All tab)
      if (filters.isActive !== undefined) {
        qb.andWhere('patient.isActive = :isActive', {
          isActive: filters.isActive,
        });
      }

      // Filter by gender when provided
      if (filters.gender) {
        qb.andWhere('patient.gender = :gender', {
          gender: filters.gender,
        });
      }

      if (filters.appointmentStatus && filters.appointmentStatus.length > 0) {
        qb.andWhere('appointment.status IN (:...appointmentStatus)', {
          appointmentStatus: filters.appointmentStatus,
        });
      }

      if (filters.hasActiveAppointments !== undefined) {
        const activeStatuses = ['IN_PROGRESS', 'MISSED', 'SCHEDULED'];
        if (filters.hasActiveAppointments) {
          qb.andWhere('appointment.status IN (:...activeStatuses)', {
            activeStatuses,
          });
        } else {
          qb.andWhere(
            '(appointment.id IS NULL OR appointment.status NOT IN (:...inactiveStatuses))',
            { inactiveStatuses: activeStatuses },
          );
        }
      }

      const [patients, total] = await qb
        .orderBy('patient.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit)
        .getManyAndCount();

      // Decrypt patient fields (no relation data loaded → no recursive overhead)
      await Promise.all(patients.map((p) => this.decryptEntityFields(p)));

      // ── Query 3: batch-fetch insurance for the displayed page only ──
      if (patients.length > 0) {
        await this.attachInsurance(patients);
        await this.attachActiveAppointmentStatus(patients);
      }

      return [patients, total];
    } catch (error) {
      this.logger.error('Error finding patients with filters', error);
      throw error;
    }
  }

  /**
   * Batch-load insurance (+ provider + scheme) for a small set of patients.
   * Runs a single query: SELECT … WHERE patientId IN (…N ids…)
   * N is the page size (typically 10) — always fast regardless of table size.
   */
  private async attachInsurance(patients: Patient[]): Promise<void> {
    const patientIds = patients.map((p) => p.id);

    const records = await this.dataSource
      .getRepository(PatientInsurance)
      .createQueryBuilder('ins')
      .leftJoinAndSelect('ins.insuranceProvider', 'provider')
      .leftJoinAndSelect('ins.scheme', 'scheme')
      .where('ins.patientId IN (:...patientIds)', { patientIds })
      .getMany();

    // Insurance records are fetched via raw TypeORM (no EncryptedRepository),
    // so their sensitive fields (e.g. membershipNumber) are still encrypted.
    // Decrypt them here using the same logic applied to patient fields above.
    await Promise.all(records.map((r) => this.decryptEntityFields(r)));

    const byPatient = new Map(
      records.map((r) => [r.patientId, r]),
    );

    for (const patient of patients) {
      patient.insurance = byPatient.get(patient.id);
    }
  }

  /**
   * Batch-check which patients on this page have an active appointment.
   * Runs a single query: SELECT patientId FROM appointments WHERE patientId IN (…)
   * AND status IN (SCHEDULED, IN_PROGRESS, MISSED) AND isActive = true.
   * Sets patient.appointments to a minimal stub so PatientResponseDto.fromEntity()
   * correctly computes hasActiveAppointments without loading full appointment objects.
   */
  private async attachActiveAppointmentStatus(patients: Patient[]): Promise<void> {
    const patientIds = patients.map((p) => p.id);
    const activeStatuses = [
      AppointmentStatus.SCHEDULED,
      AppointmentStatus.IN_PROGRESS,
      AppointmentStatus.MISSED,
    ];

    const rows: { patientId: string }[] = await this.dataSource
      .getRepository(Appointment)
      .createQueryBuilder('a')
      .select('a.patientId', 'patientId')
      .where('a.patientId IN (:...patientIds)', { patientIds })
      .andWhere('a.status IN (:...statuses)', { statuses: activeStatuses })
      .andWhere('a.isActive = :isActive', { isActive: true })
      .groupBy('a.patientId')
      .getRawMany();

    const activeSet = new Set(rows.map((r) => r.patientId));

    for (const patient of patients) {
      // Minimal stub — PatientResponseDto.fromEntity() only checks
      // appointment.isActive + appointment.status, so no other fields needed.
      patient.appointments = activeSet.has(patient.id)
        ? [{ isActive: true, status: AppointmentStatus.SCHEDULED } as Appointment]
        : [];
    }
  }

  /**
   * Batch-attach insurance and active-appointment status for a page of patients.
   * Used after in-memory indexed search so the response matches the standard
   * findPatientsWithFilters output (which attaches these automatically).
   *
   * Only runs two small queries (insurance + appointments) for N ≤ page-size patients.
   */
  async attachMedicalDetails(patients: Patient[]): Promise<void> {
    if (patients.length === 0) return;
    await this.attachInsurance(patients);
    await this.attachActiveAppointmentStatus(patients);
  }

  /**
   * Lightweight query for index rebuild — skips COUNT, loads no relations.
   * Returns decrypted Patient entities with all own columns.
   */
  async findPatientsForIndexing(
    offset: number,
    limit: number,
    workspaceId?: string,
  ): Promise<Patient[]> {
    const where: FindOptionsWhere<Patient> = { isActive: true } as FindOptionsWhere<Patient>;
    if (workspaceId) {
      (where as any).workspaceId = workspaceId;
    }
    return this.find({
      where,
      skip: offset,
      take: limit,
      order: { createdAt: 'DESC' } as any,
    });
  }

  /**
   * Search patients by encrypted fields
   * Uses the base EncryptedRepository's searchEncryptedFields method
   */
  async searchByEncryptedField(
    fieldName: string,
    searchValue: string,
    page: number,
    limit: number,
    workspaceId?: string,
  ): Promise<PaginatedPatientResult> {
    this.logger.log(`Searching patients by encrypted field: ${fieldName} with value: ${searchValue}${workspaceId ? ` in workspace: ${workspaceId}` : ''}`);

    const startTime = Date.now();

    try {
      // Use base class encrypted search with caching and fuzzy matching
      const [patients, total] = await this.searchEncryptedFields(
        searchValue,
        page,
        limit,
        {
          searchFields: [fieldName],
          useCache: true,
          batchSize: 100,
          maxResults: 1000,
        },
      );

      const executionTime = Date.now() - startTime;

      this.logger.log(`Found ${total} patients matching encrypted field search in ${executionTime}ms`);

      return {
        data: patients,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
        searchMetadata: {
          searchTerm: searchValue,
          searchMethod: 'encrypted',
          executionTime,
          cacheHit: false, // Base class manages cache internally
        },
      };
    } catch (error) {
      this.logger.error(`Error searching by encrypted field: ${fieldName}`, error);
      throw error;
    }
  }

  /**
   * Bulk save patients
   * Note: Encryption is handled automatically by the base EncryptedRepository
   */
  async bulkSave(patients: Partial<Patient>[]): Promise<Patient[]> {
    this.logger.log(`Bulk saving ${patients.length} patients`);

    try {
      // Base class save handles encryption automatically
      const results = await Promise.all(
        patients.map((patient) => this.save(patient)),
      );

      this.logger.log(`Successfully bulk saved ${results.length} patients`);
      return results as Patient[];
    } catch (error) {
      this.logger.error('Error bulk saving patients', error);
      throw error;
    }
  }
}
