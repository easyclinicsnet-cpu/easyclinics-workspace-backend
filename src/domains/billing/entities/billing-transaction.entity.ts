import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { PatientBill } from './patient-bill.entity';
import { Payment } from './payment.entity';

/**
 * Billing Transaction Entity
 * Tracks all financial transactions related to billing
 */
@Entity('billing_transactions')
@Index('IDX_billing_transactions_transaction_reference', ['transactionReference'], { unique: true })
export class BillingTransaction extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  transactionReference: string;

  @Column({ type: 'varchar', length: 50 })
  transactionType: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  billId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  paymentId?: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  balanceBefore: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  balanceAfter: number;

  @Column({ type: 'varchar', length: 50 })
  status: string;

  @Column({ type: 'datetime' })
  transactionDate: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  processedBy?: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

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

  @ManyToOne(() => PatientBill, { nullable: true })
  @JoinColumn({ name: 'billId' })
  bill?: PatientBill;

  @ManyToOne(() => Payment, { nullable: true })
  @JoinColumn({ name: 'paymentId' })
  payment?: Payment;
}
