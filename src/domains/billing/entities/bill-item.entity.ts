import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { PatientBill } from './patient-bill.entity';
import { InsuranceClaimStatus } from '../../../common/enums';

/**
 * Bill Item Entity
 * Individual line items on a patient bill.
 *
 * Snapshot semantics: once created, a BillItem is an immutable financial record.
 * medicationItemId and consumableItemId are soft references (stored for traceability)
 * and intentionally have NO @ManyToOne decorator — the item name, price, and quantity
 * are captured at dispense time in description/unitPrice/totalPrice so that future
 * inventory changes never alter past bills.
 */
@Entity('bill_items')
@Index('IDX_bill_items_workspace', ['workspaceId'])
@Index('IDX_bill_items_workspace_bill', ['workspaceId', 'billId'])
export class BillItem extends BaseEntity {
  // ===== MULTI-TENANCY =====
  @Column({ type: 'varchar', length: 255, nullable: false })
  workspaceId: string;

  @Column({ type: 'varchar', length: 255 })
  billId: string;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({ type: 'decimal', precision: 12, scale: 4 })
  quantity: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  unitPrice: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  totalPrice: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  department?: string;

  // Soft reference — snapshot only. Do NOT add @ManyToOne here.
  // Billing immutability requires these to be denormalized FKs, not live relations.
  @Column({ type: 'varchar', length: 255, nullable: true })
  medicationItemId?: string;

  // Soft reference — snapshot only. Do NOT add @ManyToOne here.
  @Column({ type: 'varchar', length: 255, nullable: true })
  consumableItemId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  batchId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  dispensedBy?: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  actualUnitCost?: number;

  @Column({ type: 'boolean', nullable: true })
  hasInsuranceClaim?: boolean;

  @Column({
    type: 'enum',
    enum: InsuranceClaimStatus,
    default: InsuranceClaimStatus.NOT_CLAIMED,
  })
  insuranceClaimStatus: InsuranceClaimStatus;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalClaimedAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalApprovedAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalDeniedAmount: number;

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

  @ManyToOne(() => PatientBill, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'billId' })
  bill: PatientBill;
}
