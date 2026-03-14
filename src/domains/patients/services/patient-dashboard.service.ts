import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { Aes256Service } from '../../../common/security/encryption/aes-256.service';
import { PatientRepository } from '../repositories/patient.repository';
import {
  AppointmentStatus,
  AuditEventType,
  AuditOutcome,
  BillStatus,
  PrescriptionStatus,
  Severity,
} from '../../../common/enums';
import { PatientResponseDto } from '../dto/patient/patient-response.dto';
import {
  AlertsSectionDto,
  AppointmentsSectionDto,
  BillingSectionDto,
  CareNotesSectionDto,
  ClinicalAlertDto,
  ClinicalHistorySectionDto,
  ConsultationsSectionDto,
  DashboardAlertSeverity,
  DashboardAlertType,
  DashboardAllergyDto,
  DashboardAppointmentDto,
  DashboardBillDto,
  DashboardCareNoteDto,
  DashboardConsultationDto,
  DashboardFamilyConditionDto,
  DashboardInsuranceDto,
  DashboardMedicalConditionDto,
  DashboardPrescriptionDto,
  DashboardReferralDto,
  DashboardRepeatPrescriptionDto,
  DashboardSocialHistoryDto,
  DashboardSurgicalHistoryDto,
  DashboardVitalDto,
  MedicationsSectionDto,
  PatientDashboardResponseDto,
  PatientSummaryStatsDto,
  VitalSignsSectionDto,
  VitalTrendPointDto,
} from '../dto/patient/patient-dashboard-response.dto';

// ─────────────────────────────────────────────────────────────────────────────

/** Internal shape returned by fetchAppointmentAggregate(). */
interface AppointmentAggregate {
  total:          number;
  completedCount: number;
  lastVisitDate:  string | null;
  firstVisitDate: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * PatientDashboardService
 *
 * Aggregates data from all EMR domains into a single holistic patient view.
 *
 * ┌─ Query strategy ────────────────────────────────────────────────────────┐
 * │  All domain queries run in parallel (Promise.all) in a single round.   │
 * │                                                                         │
 * │  Key optimisations vs. original implementation:                        │
 * │  1. Appointments split into two targeted queries by status so          │
 * │     COMPLETED/MISSED/CANCELLED appointments are not filtered out       │
 * │     by the old `isActive: true` predicate (which always hid them).     │
 * │  2. fetchCareNotesWithCount() replaces two separate queries using       │
 * │     getManyAndCount() — saves one DB round-trip.                       │
 * │  3. consultations and referrals use findAndCount() with a consistent   │
 * │     WHERE clause so find-result count == total-count.                  │
 * │  4. fetchAppointmentAggregate() returns total / completedCount /       │
 * │     lastVisitDate / firstVisitDate in one SQL query instead of the     │
 * │     previous approach that scanned a 30-item JS array (always wrong   │
 * │     because isActive:true excluded all completed appointments).        │
 * │  5. All decryptXxx() helpers decrypt fields within each record in      │
 * │     parallel (inner Promise.all per record) rather than sequentially.  │
 * │  6. All section-builder helpers do a single O(N) pass instead of       │
 * │     multiple filter/map/sort chains over the same array.               │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
@Injectable()
export class PatientDashboardService {
  constructor(
    private readonly dataSource:        DataSource,
    private readonly patientRepository: PatientRepository,
    private readonly aesService:        Aes256Service,
    private readonly logger:            LoggerService,
    private readonly auditLogService:   AuditLogService,
  ) {
    this.logger.setContext('PatientDashboardService');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────

  async getDashboard(
    patientId:   string,
    userId:      string,
    workspaceId: string,
  ): Promise<PatientDashboardResponseDto> {
    this.logger.log(`Generating dashboard for patient: ${patientId}`);

    // Patient must exist — also handles decryption of patient fields.
    const patient = await this.patientRepository.findByIdWithRelations(patientId, workspaceId);
    if (!patient) {
      throw new NotFoundException(`Patient with ID ${patientId} not found in workspace`);
    }

    // HIPAA audit (non-blocking — must not delay the response).
    this.auditLogService
      .log(
        {
          userId,
          action:       'VIEW_PATIENT_DASHBOARD',
          eventType:    AuditEventType.READ,
          outcome:      AuditOutcome.SUCCESS,
          resourceType: 'Patient',
          resourceId:   patientId,
          patientId,
          justification: 'Patient dashboard access',
        },
        workspaceId,
      )
      .catch((err: Error) => this.logger.error('Dashboard audit log failed', err.stack));

    const mgr = this.dataSource.manager;

    // ── Round 1: parallel fetch across all domains ──────────────────────────
    //
    // 16 parallel DB calls (down from 18 in original).
    // Notable changes:
    //  • appointments (buggy single query) → upcomingAppointments + recentAppointments
    //  • recentCareNotes + careNoteCount    → careNotesWithCount  (getManyAndCount)
    //  • consultations find + count         → consultationsWithCount (findAndCount)
    //  • referralLetters find + count       → referralsWithCount     (findAndCount)
    //  • totalAppointments count            → appointmentAggregate   (richer aggregate)
    const [
      allergies,
      vitals,
      medicalHistory,
      surgicalHistory,
      familyConditions,
      socialHistories,
      upcomingAppointments,   // SCHEDULED / IN_PROGRESS — sorted ASC
      recentAppointments,     // COMPLETED / MISSED / CANCELLED — sorted DESC
      consultationsWithCount, // [Consultation[], totalCount]
      careNotesWithCount,     // [CareNote[], totalCount]
      referralsWithCount,     // [ReferralLetter[], totalCount]
      repeatPrescriptions,
      recentPrescriptions,
      recentBills,
      appointmentAggregate,   // { total, completedCount, lastVisitDate, firstVisitDate }
      billAggregate,
    ] = await Promise.all([

      // ── Clinical history (patients domain) ────────────────────────────────
      mgr.find('Allergy', {
        where: { patientId, isActive: true },
        order: { createdAt: 'DESC' },
      } as any),

      mgr.find('Vital', {
        where: { patientId, isActive: true },
        order: { createdAt: 'DESC' },
        take: 10,
      } as any),

      mgr.find('PastMedicalHistory', {
        where: { patientId, isActive: true },
        order: { createdAt: 'DESC' },
      } as any),

      mgr.find('PastSurgicalHistory', {
        where: { patientId, isActive: true },
        order: { createdAt: 'DESC' },
      } as any),

      mgr.find('FamilyCondition', {
        where: { patientId, isActive: true },
        order: { createdAt: 'DESC' },
      } as any),

      mgr.find('SocialHistory', {
        where: { patientId, isActive: true },
        order: { createdAt: 'DESC' },
        take: 1,
      } as any),

      // ── Appointments (split by status — fixes isActive:true exclusion bug) ─
      this.fetchUpcomingAppointments(patientId, 5),
      this.fetchRecentAppointments(patientId, 10),

      // ── Consultations: find + count in one call ───────────────────────────
      mgr.findAndCount('Consultation', {
        where: { patientId, isActive: true },
        order: { createdAt: 'DESC' },
        take: 10,
      } as any),

      // ── Care notes: find + count in one call ──────────────────────────────
      this.fetchCareNotesWithCount(patientId, 5),

      // ── Referral letters: find + count in one call ────────────────────────
      mgr.findAndCount('ReferralLetter', {
        where: { patientId, isActive: true },
        order: { createdAt: 'DESC' },
        take: 5,
      } as any),

      // ── Medications ───────────────────────────────────────────────────────
      mgr.find('RepeatPrescription', {
        where: { patientId, isActive: true },
        order: { createdAt: 'DESC' },
      } as any),

      this.fetchRecentPrescriptions(patientId, 15),

      // ── Billing ───────────────────────────────────────────────────────────
      mgr.find('PatientBill', {
        where: { patientId },
        order: { issuedAt: 'DESC' },
        take: 5,
      } as any),

      // ── Appointment aggregate: total / completed / date range in one call ─
      this.fetchAppointmentAggregate(patientId),

      // ── Bill aggregate ────────────────────────────────────────────────────
      this.fetchBillAggregate(patientId),
    ]);

    // ── Unpack merged query results ────────────────────────────────────────
    const [consultations, totalConsultations] = consultationsWithCount as [any[], number];
    const [careNotes,     careNoteCount]      = careNotesWithCount     as [any[], number];
    const [referralLetters, referralCount]    = referralsWithCount     as [any[], number];
    const apptAggregate = appointmentAggregate as AppointmentAggregate;

    // ── Round 2: per-consultation note/Rx counts ───────────────────────────
    const consultationIds = (consultations as any[]).map((c: any) => c.id);
    const [consultationNoteCounts, consultationRxCounts] =
      consultationIds.length > 0
        ? await Promise.all([
            this.fetchConsultationNoteCounts(consultationIds),
            this.fetchConsultationPrescriptionCounts(consultationIds),
          ])
        : [new Map<string, number>(), new Map<string, number>()];

    // ── Round 3: parallel decryption (all fields within each record in parallel) ──
    const [
      decryptedAllergies,
      decryptedVitals,
      decryptedMedicalHistory,
      decryptedSurgicalHistory,
      decryptedFamilyConditions,
      decryptedSocialHistories,
      decryptedCareNotes,
      decryptedReferralLetters,
      decryptedPrescriptions,
      decryptedRepeatRx,
    ] = await Promise.all([
      this.decryptAllergies(allergies         as any[]),
      this.decryptVitals(vitals               as any[]),
      this.decryptMedicalHistory(medicalHistory as any[]),
      this.decryptSurgicalHistory(surgicalHistory as any[]),
      this.decryptFamilyConditions(familyConditions as any[]),
      this.decryptSocialHistories(socialHistories as any[]),
      this.decryptCareNotes(careNotes         as any[]),
      this.decryptReferralLetters(referralLetters as any[]),
      this.decryptPrescriptions(recentPrescriptions as any[]),
      this.decryptRepeatPrescriptions(repeatPrescriptions as any[]),
    ]);

    // ── Assemble dashboard sections ────────────────────────────────────────
    const patientDto = PatientResponseDto.fromEntity(patient);
    patientDto.age   = this.patientRepository.getAgeString(patient);

    return {
      patient: patientDto as any,

      alerts: this.buildAlerts(
        decryptedAllergies,
        patient.insurance as any,
        recentBills as any[],
      ),

      vitalSigns: this.buildVitalSigns(decryptedVitals),

      medications: this.buildMedications(decryptedPrescriptions, decryptedRepeatRx),

      appointments: this.buildAppointments(
        upcomingAppointments as any[],
        recentAppointments   as any[],
        apptAggregate.total,
        apptAggregate.lastVisitDate,
      ),

      consultations: this.buildConsultations(
        consultations as any[],
        totalConsultations as number,
        consultationNoteCounts,
        consultationRxCounts,
      ),

      clinicalHistory: this.buildClinicalHistory(
        decryptedAllergies,
        decryptedMedicalHistory,
        decryptedSurgicalHistory,
        decryptedFamilyConditions,
        decryptedSocialHistories,
      ),

      careNotes: this.buildCareNotes(
        decryptedCareNotes,
        careNoteCount as number,
        decryptedReferralLetters,
        referralCount as number,
      ),

      insurance: this.buildInsurance(patient.insurance as any),

      billing: this.buildBilling(recentBills as any[], billAggregate as any),

      summary: this.buildSummaryStats(
        apptAggregate,
        totalConsultations as number,
        decryptedPrescriptions,
        decryptedRepeatRx,
        decryptedAllergies,
        decryptedMedicalHistory,
        decryptedSurgicalHistory,
        referralCount as number,
        patient,
      ),

      generatedAt: new Date().toISOString(),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE: DATABASE HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Upcoming appointments: SCHEDULED or IN_PROGRESS, sorted ASC by date.
   * Replaces the old `mgr.find('Appointment', { isActive: true })` which
   * incorrectly excluded COMPLETED/MISSED/CANCELLED appointments and made
   * the "recent" section of the dashboard permanently empty.
   */
  private async fetchUpcomingAppointments(patientId: string, limit: number): Promise<unknown[]> {
    return this.dataSource.manager
      .createQueryBuilder('Appointment', 'a')
      .where('a.patientId = :patientId', { patientId })
      .andWhere('a.status IN (:...statuses)', {
        statuses: [AppointmentStatus.SCHEDULED, AppointmentStatus.IN_PROGRESS],
      })
      .orderBy('a.date', 'ASC')
      .limit(limit)
      .getMany();
  }

  /**
   * Recent terminal appointments: COMPLETED, MISSED, CANCELLED, sorted DESC.
   * Combined with fetchUpcomingAppointments() these two targeted queries
   * replace the single buggy query that filtered by isActive:true.
   */
  private async fetchRecentAppointments(patientId: string, limit: number): Promise<unknown[]> {
    return this.dataSource.manager
      .createQueryBuilder('Appointment', 'a')
      .where('a.patientId = :patientId', { patientId })
      .andWhere('a.status IN (:...statuses)', {
        statuses: [AppointmentStatus.COMPLETED, AppointmentStatus.MISSED, AppointmentStatus.CANCELLED],
      })
      .orderBy('a.date', 'DESC')
      .limit(limit)
      .getMany();
  }

  /**
   * Returns [careNotes, totalCount] in a single DB round-trip using
   * getManyAndCount(). Replaces the previous fetchCareNotes() + countCareNotes()
   * pair that ran two structurally identical queries.
   */
  private async fetchCareNotesWithCount(
    patientId: string,
    limit: number,
  ): Promise<[unknown[], number]> {
    return this.dataSource.manager
      .createQueryBuilder('CareNote', 'cn')
      .innerJoin('Consultation', 'c', 'c.id = cn.consultationId')
      .where('c.patientId = :patientId', { patientId })
      .andWhere('cn.isLatestVersion = :latest', { latest: true })
      .andWhere('cn.deletedAt IS NULL')
      .orderBy('cn.createdAt', 'DESC')
      .limit(limit)
      .getManyAndCount();
  }

  /**
   * Returns appointment aggregate stats in one SQL round-trip.
   *
   * Replaces:
   *  • mgr.count('Appointment', { where: { patientId } }) — only gave total
   *  • appointments.filter(COMPLETED).length               — always 0 (bug)
   *  • appointments.filter(COMPLETED).sort()[0]            — always undefined
   *  • appointments.sort(asc)[0]                           — based on 30-item window
   *
   * The aggregate is computed at the DB level so all values are correct
   * regardless of how many appointments the patient has.
   */
  private async fetchAppointmentAggregate(patientId: string): Promise<AppointmentAggregate> {
    const row = await this.dataSource.manager
      .createQueryBuilder('Appointment', 'a')
      .select('COUNT(*)', 'total')
      .addSelect('SUM(CASE WHEN a.status = :done THEN 1 ELSE 0 END)', 'completedCount')
      .addSelect('MAX(CASE WHEN a.status = :done THEN a.date ELSE NULL END)', 'lastVisitDate')
      .addSelect('MIN(a.date)', 'firstVisitDate')
      .where('a.patientId = :patientId', { patientId })
      .setParameter('done', AppointmentStatus.COMPLETED)
      .getRawOne<{
        total:          string;
        completedCount: string;
        lastVisitDate:  unknown;
        firstVisitDate: unknown;
      }>();

    const toIsoDate = (v: unknown): string | null => {
      if (!v) return null;
      if (typeof v === 'string') return v.slice(0, 10);
      if (v instanceof Date)     return v.toISOString().slice(0, 10);
      return String(v).slice(0, 10);
    };

    return {
      total:          parseInt(row?.total          ?? '0', 10),
      completedCount: parseInt(row?.completedCount ?? '0', 10),
      lastVisitDate:  toIsoDate(row?.lastVisitDate),
      firstVisitDate: toIsoDate(row?.firstVisitDate),
    };
  }

  /** Prescriptions joined through consultations (no direct patientId on Prescription). */
  private async fetchRecentPrescriptions(patientId: string, limit: number): Promise<unknown[]> {
    return this.dataSource.manager
      .createQueryBuilder('Prescription', 'p')
      .innerJoin('Consultation', 'c', 'c.id = p.consultationId')
      .where('c.patientId = :patientId', { patientId })
      .andWhere('p.deletedAt IS NULL')
      .orderBy('p.createdAt', 'DESC')
      .limit(limit)
      .getMany();
  }

  /** Note counts per consultation — single GROUP BY query. */
  private async fetchConsultationNoteCounts(
    consultationIds: string[],
  ): Promise<Map<string, number>> {
    const rows = await this.dataSource.manager
      .createQueryBuilder('CareNote', 'cn')
      .select('cn.consultationId', 'consultationId')
      .addSelect('COUNT(cn.id)', 'count')
      .where('cn.consultationId IN (:...ids)', { ids: consultationIds })
      .andWhere('cn.isLatestVersion = :latest', { latest: true })
      .andWhere('cn.deletedAt IS NULL')
      .groupBy('cn.consultationId')
      .getRawMany<{ consultationId: string; count: string }>();

    const map = new Map<string, number>();
    rows.forEach((r) => map.set(r.consultationId, parseInt(r.count, 10)));
    return map;
  }

  /** Prescription counts per consultation — single GROUP BY query. */
  private async fetchConsultationPrescriptionCounts(
    consultationIds: string[],
  ): Promise<Map<string, number>> {
    const rows = await this.dataSource.manager
      .createQueryBuilder('Prescription', 'p')
      .select('p.consultationId', 'consultationId')
      .addSelect('COUNT(p.id)', 'count')
      .where('p.consultationId IN (:...ids)', { ids: consultationIds })
      .andWhere('p.deletedAt IS NULL')
      .groupBy('p.consultationId')
      .getRawMany<{ consultationId: string; count: string }>();

    const map = new Map<string, number>();
    rows.forEach((r) => map.set(r.consultationId, parseInt(r.count, 10)));
    return map;
  }

  private async fetchBillAggregate(
    patientId: string,
  ): Promise<{ totalBilled: string; totalOutstanding: string }> {
    const unpaid = ['PENDING', 'OVERDUE', 'PARTIALLY_PAID', 'PARTIAL'];
    const result = await this.dataSource.manager
      .createQueryBuilder('PatientBill', 'pb')
      .select('COALESCE(SUM(pb.total), 0)', 'totalBilled')
      .addSelect(
        `COALESCE(SUM(CASE WHEN pb.status IN (:...unpaid) THEN pb.total ELSE 0 END), 0)`,
        'totalOutstanding',
      )
      .where('pb.patientId = :patientId', { patientId })
      .setParameter('unpaid', unpaid)
      .getRawOne<{ totalBilled: string; totalOutstanding: string }>();
    return result ?? { totalBilled: '0', totalOutstanding: '0' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE: DECRYPTION HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Safely decrypt a single value.
   * Returns the raw string unchanged if decryption fails
   * (handles fields that were stored in plaintext).
   */
  private async safeDecrypt(value: string | null | undefined): Promise<string | undefined> {
    if (!value) return value ?? undefined;
    try {
      return await this.aesService.decrypt(value);
    } catch {
      return value;
    }
  }

  /**
   * All decryptXxx() methods use an inner Promise.all() per record so that
   * multiple fields on the same row are decrypted concurrently rather than
   * sequentially.  The outer Promise.all() already ran records concurrently;
   * the inner Promise.all() parallelises fields within each record.
   *
   * Example (vitals, 8 fields × 10 records):
   *   Before: 10 × 8 sequential awaits = 80 serial microtasks
   *   After:  10 parallel batches of 8 concurrent calls
   */

  private async decryptPrescriptions(prescriptions: any[]): Promise<any[]> {
    return Promise.all(
      prescriptions.map((p) =>
        Promise.all([
          this.safeDecrypt(p.medicine),
          this.safeDecrypt(p.dose),
          this.safeDecrypt(p.route),
          this.safeDecrypt(p.frequency),
          this.safeDecrypt(p.days),
        ]).then(([medicine, dose, route, frequency, days]) => ({
          ...p, medicine, dose, route, frequency, days,
        })),
      ),
    );
  }

  private async decryptRepeatPrescriptions(rxList: any[]): Promise<any[]> {
    return Promise.all(
      rxList.map((rx) =>
        Promise.all([
          this.safeDecrypt(rx.medicine),
          this.safeDecrypt(rx.dose),
          this.safeDecrypt(rx.route),
          this.safeDecrypt(rx.frequency),
          this.safeDecrypt(rx.clinicalIndication),
        ]).then(([medicine, dose, route, frequency, clinicalIndication]) => ({
          ...rx, medicine, dose, route, frequency, clinicalIndication,
        })),
      ),
    );
  }

  private async decryptAllergies(allergies: any[]): Promise<any[]> {
    return Promise.all(
      allergies.map((a) =>
        Promise.all([
          this.safeDecrypt(a.substance),
          this.safeDecrypt(a.reaction),
        ]).then(([substance, reaction]) => ({ ...a, substance, reaction })),
      ),
    );
  }

  private async decryptVitals(vitals: any[]): Promise<any[]> {
    return Promise.all(
      vitals.map((v) =>
        Promise.all([
          this.safeDecrypt(v.temperature),
          this.safeDecrypt(v.bloodPressure),
          this.safeDecrypt(v.heartRate),
          this.safeDecrypt(v.saturation),
          this.safeDecrypt(v.gcs),
          this.safeDecrypt(v.bloodGlucose),
          this.safeDecrypt(v.height),
          this.safeDecrypt(v.weight),
        ]).then(([temperature, bloodPressure, heartRate, saturation, gcs, bloodGlucose, height, weight]) => ({
          ...v,
          temperature, bloodPressure, heartRate,
          saturation, gcs, bloodGlucose, height, weight,
        })),
      ),
    );
  }

  private async decryptMedicalHistory(history: any[]): Promise<any[]> {
    return Promise.all(
      history.map((h) =>
        Promise.all([
          this.safeDecrypt(h.condition),
          this.safeDecrypt(h.details),
        ]).then(([condition, details]) => ({ ...h, condition, details })),
      ),
    );
  }

  private async decryptSurgicalHistory(history: any[]): Promise<any[]> {
    return Promise.all(
      history.map((s) =>
        Promise.all([
          this.safeDecrypt(s.procedure),
          this.safeDecrypt(s.operation),
          this.safeDecrypt(s.details),
        ]).then(([procedure, operation, details]) => ({ ...s, procedure, operation, details })),
      ),
    );
  }

  private async decryptFamilyConditions(conditions: any[]): Promise<any[]> {
    return Promise.all(
      conditions.map((f) =>
        Promise.all([
          this.safeDecrypt(f.condition),
          this.safeDecrypt(f.relationship),
          this.safeDecrypt(f.relation),
          this.safeDecrypt(f.notes),
        ]).then(([condition, relationship, relation, notes]) => ({
          ...f, condition, relationship, relation, notes,
        })),
      ),
    );
  }

  private async decryptSocialHistories(histories: any[]): Promise<any[]> {
    return Promise.all(
      histories.map((s) =>
        Promise.all([
          this.safeDecrypt(s.occupation),
          this.safeDecrypt(s.additionalNotes),
        ]).then(([occupation, additionalNotes]) => ({ ...s, occupation, additionalNotes })),
      ),
    );
  }

  /** Care notes have a single encrypted field — inner Promise.all not needed. */
  private async decryptCareNotes(notes: any[]): Promise<any[]> {
    return Promise.all(
      notes.map(async (n) => ({ ...n, content: await this.safeDecrypt(n.content) })),
    );
  }

  private async decryptReferralLetters(referrals: any[]): Promise<any[]> {
    return Promise.all(
      referrals.map((r) =>
        Promise.all([
          this.safeDecrypt(r.reasonForReferral),
          this.safeDecrypt(r.clinicalHistory),
          this.safeDecrypt(r.examinationFindings),
          this.safeDecrypt(r.investigations),
          this.safeDecrypt(r.currentMedications),
        ]).then(([reasonForReferral, clinicalHistory, examinationFindings, investigations, currentMedications]) => ({
          ...r, reasonForReferral, clinicalHistory, examinationFindings, investigations, currentMedications,
        })),
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE: SECTION BUILDERS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Builds the alerts section.
   *
   * O(A + B) single-pass — iterates allergies once and bills once.
   * Severity counters are maintained during construction so no second
   * scan is needed at the end.
   */
  private buildAlerts(
    allergies: any[],
    insurance: any,
    bills:     any[],
  ): AlertsSectionDto {
    const alerts:        ClinicalAlertDto[] = [];
    let criticalCount  = 0;
    let highCount      = 0;

    // Single pass over allergies — collect CRITICAL and SEVERE in one loop.
    for (const a of allergies) {
      if (a.severity === Severity.LIFE_THREATENING) {
        alerts.push({
          type:     DashboardAlertType.ALLERGY_CRITICAL,
          severity: DashboardAlertSeverity.CRITICAL,
          title:    `CRITICAL ALLERGY: ${a.substance}`,
          description: `Life-threatening reaction: ${a.reaction}`,
          data: { allergyId: a.id, substance: a.substance, reaction: a.reaction },
        });
        criticalCount++;
      } else if (a.severity === Severity.SEVERE) {
        alerts.push({
          type:     DashboardAlertType.ALLERGY_SEVERE,
          severity: DashboardAlertSeverity.HIGH,
          title:    `Severe Allergy: ${a.substance}`,
          description: `Severe reaction: ${a.reaction}`,
          data: { allergyId: a.id, substance: a.substance, reaction: a.reaction },
        });
        highCount++;
      }
    }

    // Insurance expiry alert.
    if (insurance?.expiryDate) {
      const expiry   = new Date(insurance.expiryDate);
      const now      = new Date();
      const daysLeft = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (daysLeft < 0) {
        alerts.push({
          type:     DashboardAlertType.INSURANCE_EXPIRED,
          severity: DashboardAlertSeverity.HIGH,
          title:    'Insurance Expired',
          description: `Insurance coverage expired ${Math.abs(daysLeft)} day(s) ago`,
          data: { insuranceId: insurance.id, expiryDate: insurance.expiryDate, daysLeft },
        });
        highCount++;
      } else if (daysLeft <= 30) {
        alerts.push({
          type:     DashboardAlertType.INSURANCE_EXPIRING,
          severity: DashboardAlertSeverity.MEDIUM,
          title:    'Insurance Expiring Soon',
          description: `Insurance expires in ${daysLeft} day(s)`,
          data: { insuranceId: insurance.id, expiryDate: insurance.expiryDate, daysLeft },
        });
      }
    }

    // Single pass over bills — accumulate overdue total while scanning.
    let overdueTotal = 0;
    let overdueCount = 0;
    for (const b of bills) {
      if (b.status === BillStatus.OVERDUE) {
        overdueTotal += Number(b.total ?? 0);
        overdueCount++;
      }
    }
    if (overdueCount > 0) {
      alerts.push({
        type:     DashboardAlertType.OVERDUE_BILL,
        severity: DashboardAlertSeverity.MEDIUM,
        title:    `Overdue Bills (${overdueCount})`,
        description: `Outstanding overdue amount: ${overdueTotal.toFixed(2)}`,
        data: { count: overdueCount, totalAmount: overdueTotal },
      });
    }

    return { alerts, criticalCount, highCount, totalCount: alerts.length };
  }

  /**
   * Builds the vital signs section.
   *
   * Single O(N) pass computes all 6 trend arrays simultaneously
   * instead of calling toTrend() 6 times (each scanning all vitals).
   * Vitals arrive DESC from DB; trends are reversed to chronological order
   * by iterating backwards in the single pass.
   */
  private buildVitalSigns(vitals: any[]): VitalSignsSectionDto {
    const toDto = (v: any): DashboardVitalDto => ({
      id:            v.id,
      temperature:   v.temperature   ?? '',
      bloodPressure: v.bloodPressure ?? '',
      heartRate:     v.heartRate     ?? '',
      saturation:    v.saturation    ?? '',
      gcs:           v.gcs           ?? '',
      bloodGlucose:  v.bloodGlucose  ?? '',
      height:        v.height        ?? '',
      weight:        v.weight        ?? '',
      time:          v.time          ?? '',
      appointmentId:  v.appointmentId,
      consultationId: v.consultationId,
      createdAt: v.createdAt ? new Date(v.createdAt).toISOString() : '',
    });

    // Build all 6 trends in one reverse pass (vitals are DESC; trends are ASC).
    const trends: {
      bloodPressure: VitalTrendPointDto[];
      heartRate:     VitalTrendPointDto[];
      temperature:   VitalTrendPointDto[];
      weight:        VitalTrendPointDto[];
      saturation:    VitalTrendPointDto[];
      bloodGlucose:  VitalTrendPointDto[];
    } = {
      bloodPressure: [],
      heartRate:     [],
      temperature:   [],
      weight:        [],
      saturation:    [],
      bloodGlucose:  [],
    };

    for (let i = vitals.length - 1; i >= 0; i--) {
      const v    = vitals[i];
      const date = v.createdAt ? new Date(v.createdAt).toISOString() : '';
      if (v.bloodPressure) trends.bloodPressure.push({ value: v.bloodPressure, date });
      if (v.heartRate)     trends.heartRate.push({ value: v.heartRate,     date });
      if (v.temperature)   trends.temperature.push({ value: v.temperature,   date });
      if (v.weight)        trends.weight.push({ value: v.weight,        date });
      if (v.saturation)    trends.saturation.push({ value: v.saturation,    date });
      if (v.bloodGlucose)  trends.bloodGlucose.push({ value: v.bloodGlucose,  date });
    }

    return {
      latest:         vitals.length > 0 ? toDto(vitals[0]) : null,
      history:        vitals.map(toDto),
      lastRecordedAt: vitals.length > 0 && vitals[0].createdAt
        ? new Date(vitals[0].createdAt).toISOString()
        : null,
      trends,
    };
  }

  private buildMedications(
    prescriptions: any[],
    repeatRx:      any[],
  ): MedicationsSectionDto {
    const rxDtos: DashboardPrescriptionDto[] = prescriptions.map((p) => ({
      id:            p.id,
      medicine:      p.medicine ?? '',
      dose:          p.dose,
      route:         p.route,
      frequency:     p.frequency,
      days:          p.days,
      consultationId: p.consultationId,
      appointmentId:  p.appointmentId,
      doctorId:       p.doctorId,
      prescribedAt:  p.createdAt ? new Date(p.createdAt).toISOString() : '',
    }));

    const repeatDtos: DashboardRepeatPrescriptionDto[] = repeatRx.map((rx) => ({
      id:                 rx.id,
      medicine:           rx.medicine ?? '',
      dose:               rx.dose,
      route:              rx.route,
      frequency:          rx.frequency,
      status:             rx.status as PrescriptionStatus,
      startDate:          rx.startDate   ? new Date(rx.startDate).toISOString()   : undefined,
      endDate:            rx.endDate     ? new Date(rx.endDate).toISOString()     : undefined,
      nextDueDate:        rx.nextDueDate ? new Date(rx.nextDueDate).toISOString() : undefined,
      reviewDate:         rx.reviewDate  ? new Date(rx.reviewDate).toISOString()  : undefined,
      daysSupply:         rx.daysSupply,
      repeatsIssued:      rx.repeatsIssued ?? 0,
      maxRepeats:         rx.maxRepeats,
      clinicalIndication: rx.clinicalIndication,
      createdAt:          rx.createdAt ? new Date(rx.createdAt).toISOString() : '',
    }));

    const activeRepeatCount = repeatDtos.filter(
      (r) => r.status === PrescriptionStatus.ACTIVE,
    ).length;

    return {
      prescriptions:       rxDtos,
      repeatPrescriptions: repeatDtos,
      totalActive:         activeRepeatCount + rxDtos.length,
    };
  }

  /**
   * Builds the appointments section.
   *
   * Inputs are pre-filtered and pre-sorted by the DB queries:
   *  • upcoming — SCHEDULED/IN_PROGRESS, ASC — no further sorting needed
   *  • recent   — COMPLETED/MISSED/CANCELLED, DESC — no further filtering needed
   *
   * O(K) where K = upcoming.length + recent.length (≤ 15).
   *
   * @param lastVisitDate — from DB aggregate (exact, not limited to the window)
   */
  private buildAppointments(
    upcoming:      any[],
    recent:        any[],
    totalCount:    number,
    lastVisitDate: string | null,
  ): AppointmentsSectionDto {
    const toDateStr = (v: any): string => {
      if (!v) return '';
      if (typeof v === 'string') return v.slice(0, 10);
      if (v instanceof Date) {
        return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
      }
      return String(v).slice(0, 10);
    };

    const toDto = (a: any): DashboardAppointmentDto => ({
      id:              a.id,
      date:            a.date ? toDateStr(a.date) : '',
      time:            a.time ?? '',
      type:            a.type,
      status:          a.status,
      paymentMethod:   a.paymentMethod ?? '',
      hasConsultation: !!a.consultationId,
      consultationId:  a.consultationId,
    });

    const upcomingDtos = upcoming.map(toDto);
    const recentDtos   = recent.map(toDto);

    return {
      upcoming:        upcomingDtos,
      recent:          recentDtos,
      nextAppointment: upcomingDtos[0] ?? null,
      lastVisitDate,
      totalCount,
    };
  }

  private buildConsultations(
    consultations:  any[],
    totalCount:     number,
    noteCounts:     Map<string, number>,
    rxCounts:       Map<string, number>,
  ): ConsultationsSectionDto {
    const recentDtos: DashboardConsultationDto[] = consultations.slice(0, 5).map((c) => ({
      id:                c.id,
      status:            c.status,
      doctorId:          c.doctorId,
      appointmentId:     c.appointmentId,
      noteCount:         noteCounts.get(c.id) ?? 0,
      prescriptionCount: rxCounts.get(c.id)   ?? 0,
      createdAt:         c.createdAt ? new Date(c.createdAt).toISOString() : '',
    }));

    const lastAt = consultations.length > 0 && consultations[0].createdAt
      ? new Date(consultations[0].createdAt).toISOString()
      : null;

    return { recent: recentDtos, totalCount, lastConsultationAt: lastAt };
  }

  private buildClinicalHistory(
    allergies:        any[],
    medicalHistory:   any[],
    surgicalHistory:  any[],
    familyConditions: any[],
    socialHistories:  any[],
  ): ClinicalHistorySectionDto {
    const allergyDtos: DashboardAllergyDto[] = allergies.map((a) => ({
      id:        a.id,
      substance: a.substance ?? '',
      reaction:  a.reaction  ?? '',
      severity:  a.severity  as Severity,
      isActive:  a.isActive  ?? true,
      createdAt: a.createdAt ? new Date(a.createdAt).toISOString() : '',
    }));

    const medConditions: DashboardMedicalConditionDto[] = medicalHistory.map((h) => ({
      id:        h.id,
      condition: h.condition ?? '',
      details:   h.details,
      isActive:  h.isActive ?? true,
      createdAt: h.createdAt ? new Date(h.createdAt).toISOString() : '',
    }));

    const surgDtos: DashboardSurgicalHistoryDto[] = surgicalHistory.map((s) => ({
      id:        s.id,
      procedure: s.procedure ?? s.operation ?? '',
      date:      s.date ? new Date(s.date).toISOString() : undefined,
      details:   s.details,
      isActive:  s.isActive ?? true,
      createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : '',
    }));

    const familyDtos: DashboardFamilyConditionDto[] = familyConditions.map((f) => ({
      id:           f.id,
      condition:    f.condition    ?? '',
      relationship: f.relationship ?? '',
      notes:        f.notes,
    }));

    let socialDto: DashboardSocialHistoryDto | null = null;
    if (socialHistories.length > 0) {
      const s = socialHistories[0];
      socialDto = {
        smokingStatus:     s.smokingStatus,
        alcoholUse:        s.alcoholUse,
        drugUse:           s.drugUse,
        occupation:        s.occupation,
        exerciseFrequency: s.exerciseFrequency,
        diet:              s.diet,
        notes:             s.notes,
        updatedAt:         s.updatedAt ? new Date(s.updatedAt).toISOString() : '',
      };
    }

    return {
      allergies:         allergyDtos,
      medicalConditions: medConditions,
      surgicalHistory:   surgDtos,
      familyHistory:     familyDtos,
      socialHistory:     socialDto,
    };
  }

  private buildCareNotes(
    careNotes:          any[],
    totalNoteCount:     number,
    referrals:          any[],
    totalReferralCount: number,
  ): CareNotesSectionDto {
    const noteDtos: DashboardCareNoteDto[] = careNotes.map((n) => ({
      id:             n.id,
      type:           n.type,
      status:         n.status,
      contentPreview: n.content ? String(n.content).substring(0, 200) : undefined,
      isAiGenerated:  n.isAiGenerated ?? false,
      authorId:       n.authorId,
      consultationId: n.consultationId,
      version:        n.version ?? 1,
      createdAt:      n.createdAt ? new Date(n.createdAt).toISOString() : '',
    }));

    const referralDtos: DashboardReferralDto[] = referrals.map((r) => ({
      id:                      r.id,
      specialty:               r.specialty ?? '',
      urgency:                 r.urgency,
      status:                  r.status,
      referredToName:          r.referredToName,
      referralDate:            r.referralDate            ? new Date(r.referralDate).toISOString()            : undefined,
      expectedAppointmentDate: r.expectedAppointmentDate ? new Date(r.expectedAppointmentDate).toISOString() : undefined,
      referenceNumber:         r.referenceNumber,
      createdAt:               r.createdAt ? new Date(r.createdAt).toISOString() : '',
    }));

    return {
      recentNotes:       noteDtos,
      recentReferrals:   referralDtos,
      totalNoteCount,
      totalReferralCount,
    };
  }

  private buildInsurance(insurance: any): DashboardInsuranceDto | null {
    if (!insurance) return null;

    const now = new Date();
    let isExpired      = false;
    let isExpiringSoon = false;
    let daysUntilExpiry: number | undefined;

    if (insurance.expiryDate) {
      const expiry    = new Date(insurance.expiryDate);
      daysUntilExpiry = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      isExpired       = daysUntilExpiry < 0;
      isExpiringSoon  = !isExpired && daysUntilExpiry <= 30;
    }

    return {
      id:               insurance.id,
      membershipNumber: insurance.membershipNumber ?? '',
      providerName:     insurance.insuranceProvider?.name
        ?? insurance.insuranceProvider?.shortName
        ?? 'Unknown Provider',
      providerCode:     insurance.insuranceProvider?.providerCode,
      schemeName:       insurance.scheme?.schemeName ?? 'Unknown Scheme',
      schemeCode:       insurance.scheme?.schemeCode,
      memberType:       insurance.memberType ?? '',
      status:           insurance.status ?? 'UNKNOWN',
      isPrimary:        insurance.isPrimary ?? true,
      effectiveDate:    insurance.effectiveDate ? new Date(insurance.effectiveDate).toISOString() : undefined,
      expiryDate:       insurance.expiryDate    ? new Date(insurance.expiryDate).toISOString()    : undefined,
      isExpired,
      isExpiringSoon,
      daysUntilExpiry,
      authorizationNumber: insurance.currentAuthorizationNumber,
    };
  }

  /**
   * Builds the billing section.
   *
   * Single O(N) pass — constructs DTOs and accumulates status counts
   * simultaneously instead of two separate map() + forEach() passes.
   */
  private buildBilling(bills: any[], aggregate: any): BillingSectionDto {
    const billDtos: DashboardBillDto[]          = [];
    const billStatusCounts: Record<string, number> = {};

    for (const b of bills) {
      billDtos.push({
        id:             b.id,
        billNumber:     b.billNumber     ?? '',
        total:          Number(b.total          ?? 0),
        subtotal:       Number(b.subtotal        ?? 0),
        discountAmount: Number(b.discountAmount  ?? 0),
        taxAmount:      Number(b.taxAmount       ?? 0),
        status:         b.status as BillStatus,
        department:     b.department,
        issuedAt:       b.issuedAt ? new Date(b.issuedAt).toISOString() : '',
        dueDate:        b.dueDate  ? new Date(b.dueDate).toISOString()  : undefined,
        appointmentId:  b.appointmentId ?? '',
      });

      const s = b.status ?? 'UNKNOWN';
      billStatusCounts[s] = (billStatusCounts[s] ?? 0) + 1;
    }

    const lastBillDate = bills.length > 0 && bills[0].issuedAt
      ? new Date(bills[0].issuedAt).toISOString()
      : null;

    return {
      recentBills:      billDtos,
      totalOutstanding: Number(aggregate?.totalOutstanding ?? 0),
      totalBilled:      Number(aggregate?.totalBilled      ?? 0),
      lastBillDate,
      billStatusCounts,
    };
  }

  /**
   * Builds the summary stats section.
   *
   * O(1) — all values come directly from DB aggregates or array lengths.
   *
   * Replaces the previous implementation that scanned the 30-item
   * appointments window with three separate filter/sort passes and
   * always returned completedAppointments=0 and lastVisitDate=null
   * due to the isActive:true query bug.
   */
  private buildSummaryStats(
    apptAggregate:    AppointmentAggregate,
    totalConsultations: number,
    prescriptions:    any[],
    repeatRx:         any[],
    allergies:        any[],
    medicalHistory:   any[],
    surgicalHistory:  any[],
    totalReferrals:   number,
    patient:          any,
  ): PatientSummaryStatsDto {
    return {
      totalAppointments:        apptAggregate.total,
      completedAppointments:    apptAggregate.completedCount,
      totalConsultations,
      totalPrescriptions:       prescriptions.length,
      totalRepeatPrescriptions: repeatRx.length,
      totalAllergies:           allergies.length,
      totalMedicalConditions:   medicalHistory.length,
      totalSurgicalProcedures:  surgicalHistory.length,
      totalReferrals,
      lastVisitDate:            apptAggregate.lastVisitDate,
      firstVisitDate:           apptAggregate.firstVisitDate,
      memberSince:              patient.createdAt ? new Date(patient.createdAt).toISOString() : '',
    };
  }
}
