import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { PatientBill } from './patient-bill.entity';
import { Patient } from '../../patients/entities/patient.entity';
import { PaymentMethod } from './payment-method.entity';
import { PaymentStatus } from '../../../common/enums';

/**
 * Payment Entity
 * Tracks payments made against bills
 */
@Entity('payments')
@Index('IDX_609e73477743140ae29ae6de48', ['paymentReference'], { unique: true })
export class Payment extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  paymentReference: string;

  @Column({ type: 'varchar', length: 255 })
  billId: string;

  @Column({ type: 'varchar', length: 255 })
  patientId: string;

  @Column({ type: 'varchar', length: 255 })
  paymentMethodId: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  processingFeePercentage?: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  processingFee: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  netAmount: number;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  status: PaymentStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  transactionId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  chequeNumber?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  bankName?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  accountNumber?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  cardLastFour?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  cardType?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  authorizationCode?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  insuranceProvider?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  insurancePolicyNumber?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  authorizationNumber?: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  paymentDate: Date;

  @Column({ type: 'timestamp', nullable: true })
  processedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  refundedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  failedAt?: Date;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ type: 'text', nullable: true })
  failureReason?: string;

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
  paymentDetails?: any;

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

  @ManyToOne(() => PatientBill)
  @JoinColumn({ name: 'billId' })
  bill: PatientBill;

  @ManyToOne(() => Patient)
  @JoinColumn({ name: 'patientId' })
  patient: Patient;

  @ManyToOne(() => PaymentMethod)
  @JoinColumn({ name: 'paymentMethodId' })
  paymentMethod: PaymentMethod;
}
