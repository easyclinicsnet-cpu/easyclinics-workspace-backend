import { Entity, Column, ManyToOne, JoinColumn, OneToOne, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Patient } from '../../patients/entities/patient.entity';
import { Appointment } from '../../appointments/entities/appointment.entity';
import { BillStatus } from '../../../common/enums';

/**
 * Patient Bill Entity
 * Manages billing for patient services and items
 */
@Entity('patient_bills')
@Index('IDX_12e5cea58f9988bea06a8ce4aa', ['billNumber'], { unique: true })
@Index('IDX_patient_bills_workspace', ['workspaceId'])
@Index('IDX_patient_bills_workspace_patient', ['workspaceId', 'patientId'])
@Index('IDX_patient_bills_workspace_status', ['workspaceId', 'status'])
export class PatientBill extends BaseEntity {
  // ===== MULTI-TENANCY =====
  @Column({ type: 'varchar', length: 255, nullable: false })
  workspaceId: string;

  @Column({ type: 'varchar', length: 255 })
  billNumber: string;

  @Column({ type: 'varchar', length: 255 })
  patientId: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  appointmentId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  department?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  discountId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  taxId?: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  subtotal: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  total: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  discountAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  taxAmount: number;

  @Column({
    type: 'enum',
    enum: BillStatus,
    default: BillStatus.DRAFT,
  })
  status: BillStatus;

  @Column({ type: 'datetime' })
  issuedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  dueDate?: Date;

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

  @ManyToOne(() => Patient)
  @JoinColumn({ name: 'patientId' })
  patient: Patient;

  @OneToOne(() => Appointment, (appointment) => appointment.patientBill)
  @JoinColumn({ name: 'appointmentId' })
  appointment: Appointment;
}
