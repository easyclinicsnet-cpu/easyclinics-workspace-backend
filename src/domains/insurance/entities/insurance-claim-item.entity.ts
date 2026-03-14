import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { InsuranceClaim } from './insurance-claim.entity';
import { InsuranceClaimStatus } from '../../../common/enums';

/**
 * Insurance Claim Item Entity
 *
 * Represents a single line item within an insurance claim.
 * Each item corresponds to one billed service or procedure.
 *
 * Multi-tenancy: Implicitly workspace-scoped via the parent InsuranceClaim,
 *   which carries workspaceId. No direct workspaceId column is needed.
 */
@Entity('insurance_claim_items')
@Index('IDX_insurance_claim_items_claim', ['claimId'])
export class InsuranceClaimItem extends BaseEntity {
  // ── Parent claim ──────────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 255 })
  claimId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  billItemId?: string;

  // ── Line identity ─────────────────────────────────────────────────────────

  @Column({ type: 'int' })
  lineNumber: number;

  @Column({ type: 'varchar', length: 255 })
  serviceCode: string;

  @Column({ type: 'varchar', length: 255 })
  serviceDescription: string;

  // ── Service dates ─────────────────────────────────────────────────────────

  @Column({ type: 'datetime' })
  serviceDate: Date;

  @Column({ type: 'datetime', nullable: true })
  serviceEndDate?: Date;

  // ── Quantity & pricing ────────────────────────────────────────────────────

  @Column({ type: 'decimal', precision: 12, scale: 4 })
  quantity: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  unit?: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  unitPrice: number;

  // ── Claim amounts ─────────────────────────────────────────────────────────

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  claimedAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  approvedAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  deniedAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  adjustedAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  paidAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  patientResponsibilityAmount: number;

  // ── Status ────────────────────────────────────────────────────────────────

  @Column({
    type: 'enum',
    enum: InsuranceClaimStatus,
    default: InsuranceClaimStatus.PENDING,
  })
  status: InsuranceClaimStatus;

  // ── Coding ────────────────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 255, nullable: true })
  diagnosisCode?: string;

  @Column({ type: 'text', nullable: true })
  diagnosisDescription?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  procedureCode?: string;

  @Column({ type: 'text', nullable: true })
  procedureDescription?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  modifierCode?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  revenueCode?: string;

  // ── Coverage ──────────────────────────────────────────────────────────────

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  coveragePercentage?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  copaymentPercentage?: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  copaymentAmount?: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  deductibleAmount?: number;

  // ── Denial & adjustment ───────────────────────────────────────────────────

  @Column({ type: 'text', nullable: true })
  denialReason?: string;

  @Column({ type: 'text', nullable: true })
  adjustmentReason?: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  // ── Rendering provider ────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 255, nullable: true })
  providerId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  providerName?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  facilityCode?: string;

  // ── Appeal ────────────────────────────────────────────────────────────────

  @Column({ type: 'boolean', default: false })
  isAppealed: boolean;

  @Column({ type: 'text', nullable: true })
  appealNotes?: string;

  // ── Extensibility ─────────────────────────────────────────────────────────

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

  @ManyToOne(() => InsuranceClaim, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'claimId' })
  claim: InsuranceClaim;
}
