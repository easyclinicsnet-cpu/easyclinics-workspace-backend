import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Payment } from './payment.entity';
import { Patient } from '../../patients/entities/patient.entity';

/**
 * Receipt Entity
 * Official proof of payment documents
 */
@Entity('receipts')
@Index('IDX_receipts_receipt_number', ['receiptNumber'], { unique: true })
export class Receipt extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  receiptNumber: string;

  @Column({ type: 'varchar', length: 255 })
  paymentId: string;

  @Column({ type: 'varchar', length: 255 })
  patientId: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @Column({ type: 'varchar', length: 255 })
  paymentMethod: string;

  @Column({ type: 'datetime' })
  issuedAt: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  issuedBy?: string;

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

  @ManyToOne(() => Payment)
  @JoinColumn({ name: 'paymentId' })
  payment: Payment;

  @ManyToOne(() => Patient)
  @JoinColumn({ name: 'patientId' })
  patient: Patient;
}
