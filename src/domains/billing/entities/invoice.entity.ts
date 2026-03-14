import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { PatientBill } from './patient-bill.entity';
import { Patient } from '../../patients/entities/patient.entity';
import { BillStatus } from '../../../common/enums';

/**
 * Invoice Entity
 * Formal billing documents issued to patients
 */
@Entity('invoices')
@Index('IDX_invoices_invoice_number', ['invoiceNumber'], { unique: true })
export class Invoice extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  invoiceNumber: string;

  @Column({ type: 'varchar', length: 255 })
  billId: string;

  @Column({ type: 'varchar', length: 255 })
  patientId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  subtotal: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  discountAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  taxAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  total: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  amountPaid: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  amountDue: number;

  @Column({
    type: 'enum',
    enum: BillStatus,
    default: BillStatus.PENDING,
  })
  status: BillStatus;

  @Column({ type: 'datetime' })
  issuedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  dueDate?: Date;

  @Column({ type: 'datetime', nullable: true })
  paidAt?: Date;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ type: 'text', nullable: true })
  terms?: string;

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
}
