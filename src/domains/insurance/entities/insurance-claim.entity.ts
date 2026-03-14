import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Patient } from '../../patients/entities/patient.entity';
import { PatientInsurance } from './patient-insurance.entity';
import { InsuranceProvider } from './insurance-provider.entity';
import { InsuranceClaimStatus } from '../../../common/enums';

/**
 * Insurance Claim Entity
 *
 * Represents an insurance claim submitted on behalf of a patient
 * for services rendered within a workspace.
 *
 * Multi-tenancy: WORKSPACE-SCOPED.
 *   Claim numbers are unique per workspace; the same number could exist
 *   in two different workspaces without conflict.
 *
 * Note: The business logic for this entity is owned by BillingModule
 *   (InsuranceClaimService). It is defined here as part of the insurance
 *   domain's entity layer so all insurance-related schema is co-located.
 */
@Entity('insurance_claims')
@Index('IDX_insurance_claims_workspace',                          ['workspaceId'])
@Index('IDX_insurance_claims_workspace_number', ['workspaceId', 'claimNumber'], { unique: true })
@Index('IDX_insurance_claims_workspace_patient', ['workspaceId', 'patientId'])
@Index('IDX_insurance_claims_workspace_status',  ['workspaceId', 'status'])
export class InsuranceClaim extends BaseEntity {
  // ── Multi-tenancy ─────────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 255 })
  workspaceId: string;

  // ── Identity ──────────────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 255 })
  claimNumber: string;

  @Column({ type: 'varchar', length: 255 })
  patientId: string;

  @Column({ type: 'varchar', length: 255 })
  patientInsuranceId: string;

  @Column({ type: 'varchar', length: 255 })
  insuranceProviderId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  billId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  appointmentId?: string;

  // ── Status & lifecycle ────────────────────────────────────────────────────

  @Column({
    type: 'enum',
    enum: InsuranceClaimStatus,
    default: InsuranceClaimStatus.PENDING,
  })
  status: InsuranceClaimStatus;

  @Column({ type: 'datetime' })
  claimDate: Date;

  @Column({ type: 'datetime', nullable: true })
  submittedDate?: Date;

  @Column({ type: 'datetime', nullable: true })
  processedDate?: Date;

  // ── Service dates ─────────────────────────────────────────────────────────

  @Column({ type: 'datetime' })
  serviceDate: Date;

  @Column({ type: 'datetime', nullable: true })
  serviceEndDate?: Date;

  // ── Financial amounts ─────────────────────────────────────────────────────

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  totalClaimedAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalApprovedAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalDeniedAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalAdjustedAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalPaidAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  patientResponsibilityAmount: number;

  // ── Authorisation & references ────────────────────────────────────────────

  @Column({ type: 'varchar', length: 255, nullable: true })
  authorizationNumber?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  referenceNumber?: string;

  // ── Diagnosis ─────────────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 255, nullable: true })
  diagnosisCode?: string;

  @Column({ type: 'text', nullable: true })
  diagnosisDescription?: string;

  // ── Provider ──────────────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 255, nullable: true })
  attendingProviderId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  attendingProviderName?: string;

  // ── Notes & reasons ───────────────────────────────────────────────────────

  @Column({ type: 'text', nullable: true })
  claimNotes?: string;

  @Column({ type: 'text', nullable: true })
  denialReason?: string;

  @Column({ type: 'text', nullable: true })
  adjustmentReason?: string;

  // ── Audit trail ───────────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 255, nullable: true })
  submittedBy?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  processedBy?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reviewedBy?: string;

  @Column({ type: 'datetime', nullable: true })
  reviewedDate?: Date;

  @Column({ type: 'text', nullable: true })
  reviewNotes?: string;

  // ── Appeal ────────────────────────────────────────────────────────────────

  @Column({ type: 'boolean', default: false })
  isAppealed: boolean;

  @Column({ type: 'datetime', nullable: true })
  appealDate?: Date;

  @Column({ type: 'text', nullable: true })
  appealNotes?: string;

  // ── Follow-up ─────────────────────────────────────────────────────────────

  @Column({ type: 'boolean', default: false })
  requiresFollowUp: boolean;

  @Column({ type: 'datetime', nullable: true })
  followUpDate?: Date;

  // ── Extensibility ─────────────────────────────────────────────────────────

  @Column({
    type: 'longtext',
    nullable: true,
    transformer: {
      to: (value: any) => (value ? JSON.stringify(value) : null),
      from: (value: string | null) => {
        if (!value) return null;
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      },
    },
  })
  attachments?: any;

   // ====================
  // Metadata
  // ====================
  @Column({
    type: 'longtext',
    nullable: true,
    transformer: {
      to: (value: any) => (value ? JSON.stringify(value) : null),
      from: (value: string | null) => {
        if (!value) return null;
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      },
    },
  })
  metadata?: Record<string, any>;

  // ── Relations ─────────────────────────────────────────────────────────────

  @ManyToOne(() => Patient)
  @JoinColumn({ name: 'patientId' })
  patient: Patient;

  @ManyToOne(() => PatientInsurance)
  @JoinColumn({ name: 'patientInsuranceId' })
  patientInsurance: PatientInsurance;

  @ManyToOne(() => InsuranceProvider)
  @JoinColumn({ name: 'insuranceProviderId' })
  insuranceProvider: InsuranceProvider;
}
