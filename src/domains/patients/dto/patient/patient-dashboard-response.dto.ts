import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Severity,
  AppointmentStatus,
  AppointmentType,
  ConsultationStatus,
  BillStatus,
  CareNoteType,
  CareNoteStatus,
  ReferralStatus,
  ReferralUrgency,
  PrescriptionStatus,
} from '../../../../common/enums';

// ─────────────────────────────────────────────────────────────────────────────
// ALERT TYPES
// ─────────────────────────────────────────────────────────────────────────────

export enum DashboardAlertType {
  ALLERGY_CRITICAL = 'ALLERGY_CRITICAL',
  ALLERGY_SEVERE   = 'ALLERGY_SEVERE',
  INSURANCE_EXPIRED  = 'INSURANCE_EXPIRED',
  INSURANCE_EXPIRING = 'INSURANCE_EXPIRING',
  OVERDUE_BILL = 'OVERDUE_BILL',
}

export enum DashboardAlertSeverity {
  CRITICAL = 'CRITICAL',
  HIGH     = 'HIGH',
  MEDIUM   = 'MEDIUM',
  LOW      = 'LOW',
  INFO     = 'INFO',
}

// ─────────────────────────────────────────────────────────────────────────────
// CLINICAL ALERT
// ─────────────────────────────────────────────────────────────────────────────

export class ClinicalAlertDto {
  @ApiProperty({ enum: DashboardAlertType })
  type!: DashboardAlertType;

  @ApiProperty({ enum: DashboardAlertSeverity })
  severity!: DashboardAlertSeverity;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  description!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  data?: Record<string, any>;
}

// ─────────────────────────────────────────────────────────────────────────────
// ALLERGY
// ─────────────────────────────────────────────────────────────────────────────

export class DashboardAllergyDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  substance!: string;

  @ApiProperty()
  reaction!: string;

  @ApiProperty({ enum: Severity })
  severity!: Severity;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  createdAt!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// VITAL SIGNS
// ─────────────────────────────────────────────────────────────────────────────

export class DashboardVitalDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'Temperature in Celsius' })
  temperature!: string;

  @ApiProperty({ description: 'Blood pressure (e.g. 120/80)' })
  bloodPressure!: string;

  @ApiProperty({ description: 'Heart rate in BPM' })
  heartRate!: string;

  @ApiProperty({ description: 'Oxygen saturation %' })
  saturation!: string;

  @ApiProperty({ description: 'Glasgow Coma Scale score' })
  gcs!: string;

  @ApiProperty({ description: 'Blood glucose in mmol/L or mg/dL' })
  bloodGlucose!: string;

  @ApiProperty({ description: 'Height in cm' })
  height!: string;

  @ApiProperty({ description: 'Weight in kg' })
  weight!: string;

  @ApiProperty()
  time!: string;

  @ApiPropertyOptional()
  appointmentId?: string;

  @ApiPropertyOptional()
  consultationId?: string;

  @ApiProperty()
  createdAt!: string;
}

export class VitalTrendPointDto {
  @ApiProperty()
  value!: string;

  @ApiProperty()
  date!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLINICAL HISTORY
// ─────────────────────────────────────────────────────────────────────────────

export class DashboardMedicalConditionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  condition!: string;

  @ApiPropertyOptional()
  details?: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  createdAt!: string;
}

export class DashboardSurgicalHistoryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'Procedure / operation name' })
  procedure!: string;

  @ApiPropertyOptional()
  date?: string;

  @ApiPropertyOptional()
  details?: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  createdAt!: string;
}

export class DashboardFamilyConditionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  condition!: string;

  @ApiProperty({ description: 'Relationship to patient (e.g. Mother, Father)' })
  relationship!: string;

  @ApiPropertyOptional()
  notes?: string;
}

export class DashboardSocialHistoryDto {
  @ApiPropertyOptional({ description: 'Smoking status' })
  smokingStatus?: string;

  @ApiPropertyOptional({ description: 'Alcohol use frequency' })
  alcoholUse?: string;

  @ApiPropertyOptional({ description: 'Drug / substance use' })
  drugUse?: string;

  @ApiPropertyOptional()
  occupation?: string;

  @ApiPropertyOptional({ description: 'Exercise frequency per week' })
  exerciseFrequency?: string;

  @ApiPropertyOptional()
  diet?: string;

  @ApiPropertyOptional()
  notes?: string;

  @ApiProperty()
  updatedAt!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// MEDICATIONS
// ─────────────────────────────────────────────────────────────────────────────

export class DashboardPrescriptionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'Medication / drug name' })
  medicine!: string;

  @ApiPropertyOptional()
  dose?: string;

  @ApiPropertyOptional({ description: 'Route of administration' })
  route?: string;

  @ApiPropertyOptional()
  frequency?: string;

  @ApiPropertyOptional({ description: 'Duration in days' })
  days?: string;

  @ApiProperty()
  consultationId!: string;

  @ApiProperty()
  appointmentId!: string;

  @ApiProperty()
  doctorId!: string;

  @ApiProperty()
  prescribedAt!: string;
}

export class DashboardRepeatPrescriptionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  medicine!: string;

  @ApiPropertyOptional()
  dose?: string;

  @ApiPropertyOptional()
  route?: string;

  @ApiPropertyOptional()
  frequency?: string;

  @ApiProperty({ enum: PrescriptionStatus })
  status!: PrescriptionStatus;

  @ApiPropertyOptional()
  startDate?: string;

  @ApiPropertyOptional()
  endDate?: string;

  @ApiPropertyOptional()
  nextDueDate?: string;

  @ApiPropertyOptional()
  reviewDate?: string;

  @ApiPropertyOptional()
  daysSupply?: number;

  @ApiProperty()
  repeatsIssued!: number;

  @ApiPropertyOptional()
  maxRepeats?: number;

  @ApiPropertyOptional()
  clinicalIndication?: string;

  @ApiProperty()
  createdAt!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// APPOINTMENTS
// ─────────────────────────────────────────────────────────────────────────────

export class DashboardAppointmentDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'Appointment date (ISO)' })
  date!: string;

  @ApiProperty()
  time!: string;

  @ApiProperty({ enum: AppointmentType })
  type!: AppointmentType;

  @ApiProperty({ enum: AppointmentStatus })
  status!: AppointmentStatus;

  @ApiProperty()
  paymentMethod!: string;

  @ApiProperty()
  hasConsultation!: boolean;

  @ApiPropertyOptional()
  consultationId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSULTATIONS
// ─────────────────────────────────────────────────────────────────────────────

export class DashboardConsultationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ConsultationStatus })
  status!: ConsultationStatus;

  @ApiProperty()
  doctorId!: string;

  @ApiProperty()
  appointmentId!: string;

  @ApiProperty()
  noteCount!: number;

  @ApiProperty()
  prescriptionCount!: number;

  @ApiProperty()
  createdAt!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CARE NOTES
// ─────────────────────────────────────────────────────────────────────────────

export class DashboardCareNoteDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: CareNoteType })
  type!: CareNoteType;

  @ApiProperty({ enum: CareNoteStatus })
  status!: CareNoteStatus;

  @ApiPropertyOptional({ description: 'First 200 characters of the note content' })
  contentPreview?: string;

  @ApiProperty()
  isAiGenerated!: boolean;

  @ApiProperty()
  authorId!: string;

  @ApiProperty()
  consultationId!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  createdAt!: string;
}

export class DashboardReferralDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'Medical specialty referred to' })
  specialty!: string;

  @ApiProperty({ enum: ReferralUrgency })
  urgency!: ReferralUrgency;

  @ApiProperty({ enum: ReferralStatus })
  status!: ReferralStatus;

  @ApiPropertyOptional()
  referredToName?: string;

  @ApiPropertyOptional()
  referralDate?: string;

  @ApiPropertyOptional()
  expectedAppointmentDate?: string;

  @ApiPropertyOptional()
  referenceNumber?: string;

  @ApiProperty()
  createdAt!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// INSURANCE
// ─────────────────────────────────────────────────────────────────────────────

export class DashboardInsuranceDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  membershipNumber!: string;

  @ApiProperty()
  providerName!: string;

  @ApiPropertyOptional()
  providerCode?: string;

  @ApiProperty()
  schemeName!: string;

  @ApiPropertyOptional()
  schemeCode?: string;

  @ApiProperty()
  memberType!: string;

  @ApiProperty({ description: 'ACTIVE | INACTIVE | SUSPENDED | EXPIRED' })
  status!: string;

  @ApiProperty()
  isPrimary!: boolean;

  @ApiPropertyOptional()
  effectiveDate?: string;

  @ApiPropertyOptional()
  expiryDate?: string;

  @ApiProperty({ description: 'True if expiryDate is in the past' })
  isExpired!: boolean;

  @ApiProperty({ description: 'True if expiry is within 30 days' })
  isExpiringSoon!: boolean;

  @ApiPropertyOptional({ description: 'Days remaining until expiry (negative if expired)' })
  daysUntilExpiry?: number;

  @ApiPropertyOptional()
  authorizationNumber?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// BILLING
// ─────────────────────────────────────────────────────────────────────────────

export class DashboardBillDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  billNumber!: string;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  subtotal!: number;

  @ApiProperty()
  discountAmount!: number;

  @ApiProperty()
  taxAmount!: number;

  @ApiProperty({ enum: BillStatus })
  status!: BillStatus;

  @ApiPropertyOptional()
  department?: string;

  @ApiProperty()
  issuedAt!: string;

  @ApiPropertyOptional()
  dueDate?: string;

  @ApiProperty()
  appointmentId!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION DTOs
// ─────────────────────────────────────────────────────────────────────────────

export class AlertsSectionDto {
  @ApiProperty({ type: [ClinicalAlertDto] })
  alerts!: ClinicalAlertDto[];

  @ApiProperty()
  criticalCount!: number;

  @ApiProperty()
  highCount!: number;

  @ApiProperty()
  totalCount!: number;
}

export class VitalSignsSectionDto {
  @ApiPropertyOptional({ type: DashboardVitalDto })
  latest!: DashboardVitalDto | null;

  @ApiProperty({ type: [DashboardVitalDto] })
  history!: DashboardVitalDto[];

  @ApiPropertyOptional()
  lastRecordedAt!: string | null;

  @ApiProperty({
    description: 'Time-series trend data for key metrics (last 10 readings)',
  })
  trends!: {
    bloodPressure: VitalTrendPointDto[];
    heartRate: VitalTrendPointDto[];
    temperature: VitalTrendPointDto[];
    weight: VitalTrendPointDto[];
    saturation: VitalTrendPointDto[];
    bloodGlucose: VitalTrendPointDto[];
  };
}

export class MedicationsSectionDto {
  @ApiProperty({ type: [DashboardPrescriptionDto] })
  prescriptions!: DashboardPrescriptionDto[];

  @ApiProperty({ type: [DashboardRepeatPrescriptionDto] })
  repeatPrescriptions!: DashboardRepeatPrescriptionDto[];

  @ApiProperty()
  totalActive!: number;
}

export class AppointmentsSectionDto {
  @ApiProperty({ type: [DashboardAppointmentDto], description: 'Upcoming SCHEDULED appointments' })
  upcoming!: DashboardAppointmentDto[];

  @ApiProperty({ type: [DashboardAppointmentDto], description: 'Recent past appointments' })
  recent!: DashboardAppointmentDto[];

  @ApiPropertyOptional({ type: DashboardAppointmentDto })
  nextAppointment!: DashboardAppointmentDto | null;

  @ApiPropertyOptional()
  lastVisitDate!: string | null;

  @ApiProperty()
  totalCount!: number;
}

export class ConsultationsSectionDto {
  @ApiProperty({ type: [DashboardConsultationDto] })
  recent!: DashboardConsultationDto[];

  @ApiProperty()
  totalCount!: number;

  @ApiPropertyOptional()
  lastConsultationAt!: string | null;
}

export class ClinicalHistorySectionDto {
  @ApiProperty({ type: [DashboardMedicalConditionDto] })
  medicalConditions!: DashboardMedicalConditionDto[];

  @ApiProperty({ type: [DashboardSurgicalHistoryDto] })
  surgicalHistory!: DashboardSurgicalHistoryDto[];

  @ApiProperty({ type: [DashboardFamilyConditionDto] })
  familyHistory!: DashboardFamilyConditionDto[];

  @ApiPropertyOptional({ type: DashboardSocialHistoryDto })
  socialHistory!: DashboardSocialHistoryDto | null;

  @ApiProperty({ type: [DashboardAllergyDto] })
  allergies!: DashboardAllergyDto[];
}

export class CareNotesSectionDto {
  @ApiProperty({ type: [DashboardCareNoteDto] })
  recentNotes!: DashboardCareNoteDto[];

  @ApiProperty({ type: [DashboardReferralDto] })
  recentReferrals!: DashboardReferralDto[];

  @ApiProperty()
  totalNoteCount!: number;

  @ApiProperty()
  totalReferralCount!: number;
}

export class BillingSectionDto {
  @ApiProperty({ type: [DashboardBillDto] })
  recentBills!: DashboardBillDto[];

  @ApiProperty({ description: 'Sum of all outstanding (unpaid) bills' })
  totalOutstanding!: number;

  @ApiProperty({ description: 'Total value of all bills ever issued' })
  totalBilled!: number;

  @ApiPropertyOptional()
  lastBillDate!: string | null;

  @ApiProperty({ description: 'Count of bills per status', type: 'object', additionalProperties: { type: 'number' } })
  billStatusCounts!: Record<string, number>;
}

export class PatientSummaryStatsDto {
  @ApiProperty()
  totalAppointments!: number;

  @ApiProperty()
  completedAppointments!: number;

  @ApiProperty()
  totalConsultations!: number;

  @ApiProperty()
  totalPrescriptions!: number;

  @ApiProperty()
  totalRepeatPrescriptions!: number;

  @ApiProperty()
  totalAllergies!: number;

  @ApiProperty()
  totalMedicalConditions!: number;

  @ApiProperty()
  totalSurgicalProcedures!: number;

  @ApiProperty()
  totalReferrals!: number;

  @ApiPropertyOptional()
  lastVisitDate!: string | null;

  @ApiPropertyOptional()
  firstVisitDate!: string | null;

  @ApiProperty({ description: 'Patient registration date (ISO)' })
  memberSince!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DASHBOARD RESPONSE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PatientDashboardResponseDto
 *
 * Comprehensive holistic patient view aggregating data from all 8 EMR domains:
 *   patients | appointments | consultations | care-notes |
 *   billing | insurance | inventory | audit
 *
 * Sections follow clinical best-practice ordering (HL7 / FHIR / Epic / Cerner standard):
 *   1. Patient demographics (header)
 *   2. Clinical alerts (allergy flags, expired insurance, overdue bills)
 *   3. Vital signs with trend sparklines
 *   4. Active medication list (prescriptions + chronic repeats)
 *   5. Appointment schedule (upcoming + history)
 *   6. Consultations summary
 *   7. Full clinical history (conditions, surgery, family, social, allergies)
 *   8. Care notes & referral letters
 *   9. Insurance coverage
 *  10. Billing summary
 *  11. Summary statistics
 */
export class PatientDashboardResponseDto {
  @ApiProperty({ description: 'Core patient demographics and identity' })
  patient!: Record<string, any>; // PatientResponseDto — typed loosely to avoid circular dep

  @ApiProperty({ type: AlertsSectionDto })
  alerts!: AlertsSectionDto;

  @ApiProperty({ type: VitalSignsSectionDto })
  vitalSigns!: VitalSignsSectionDto;

  @ApiProperty({ type: MedicationsSectionDto })
  medications!: MedicationsSectionDto;

  @ApiProperty({ type: AppointmentsSectionDto })
  appointments!: AppointmentsSectionDto;

  @ApiProperty({ type: ConsultationsSectionDto })
  consultations!: ConsultationsSectionDto;

  @ApiProperty({ type: ClinicalHistorySectionDto })
  clinicalHistory!: ClinicalHistorySectionDto;

  @ApiProperty({ type: CareNotesSectionDto })
  careNotes!: CareNotesSectionDto;

  @ApiPropertyOptional({ type: DashboardInsuranceDto })
  insurance!: DashboardInsuranceDto | null;

  @ApiProperty({ type: BillingSectionDto })
  billing!: BillingSectionDto;

  @ApiProperty({ type: PatientSummaryStatsDto })
  summary!: PatientSummaryStatsDto;

  @ApiProperty({ description: 'ISO timestamp when this dashboard snapshot was generated' })
  generatedAt!: string;
}
