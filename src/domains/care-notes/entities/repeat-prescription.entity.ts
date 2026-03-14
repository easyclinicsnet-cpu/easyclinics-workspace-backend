import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Prescription } from './prescription.entity';
import { PrescriptionStatus } from '../../../common/enums';

/**
 * Repeat Prescription Entity
 * Manages recurring prescriptions for chronic conditions
 */
@Entity('repeat_prescriptions')
@Index('IDX_repeat_prescriptions_workspace', ['workspaceId'])
@Index('IDX_repeat_prescriptions_workspace_patient', ['workspaceId', 'patientId'])
@Index('IDX_repeat_prescriptions_workspace_doctor', ['workspaceId', 'doctorId'])
@Index('IDX_repeat_prescriptions_workspace_status', ['workspaceId', 'status'])
@Index('IDX_repeat_prescriptions_workspace_next_due', ['workspaceId', 'nextDueDate'])
@Index('IDX_repeat_prescriptions_workspace_review', ['workspaceId', 'reviewDate'])
@Index('IDX_repeat_prescriptions_patient_id', ['patientId'])
@Index('IDX_repeat_prescriptions_doctor_id', ['doctorId'])
@Index('IDX_repeat_prescriptions_status', ['status'])
@Index('IDX_repeat_prescriptions_next_due', ['nextDueDate'])
@Index('IDX_repeat_prescriptions_review_date', ['reviewDate'])
@Index('IDX_repeat_prescriptions_start_date', ['startDate'])
@Index('IDX_repeat_prescriptions_end_date', ['endDate'])
@Index('IDX_repeat_prescriptions_created_at', ['createdAt'])
@Index('IDX_repeat_prescriptions_deleted_at', ['deletedAt'])
export class RepeatPrescription extends BaseEntity {
  // ===== MULTI-TENANCY =====
  @Column({ type: 'varchar', length: 255, nullable: false })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 255 })
  patientId: string;

  @Column({ type: 'varchar', length: 255 })
  doctorId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  originalPrescriptionId?: string;

  @Column({
    type: 'enum',
    enum: PrescriptionStatus,
    default: PrescriptionStatus.ACTIVE,
  })
  status: PrescriptionStatus;

  @Column({ type: 'varchar', length: 255, comment: 'Encrypted field' })
  medicine: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: 'Encrypted field' })
  dose?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: 'Encrypted field' })
  route?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: 'Encrypted field' })
  frequency?: string;

  @Column({ type: 'int', nullable: true })
  daysSupply?: number;

  @Column({ type: 'date' })
  startDate: Date;

  @Column({ type: 'date', nullable: true })
  endDate?: Date;

  @Column({ type: 'int', nullable: true })
  repeatInterval: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  repeatIntervalUnit?: string;

  @Column({ type: 'int', nullable: true })
  maxRepeats?: number;

  @Column({ type: 'int', default: 0 })
  repeatsIssued: number;

  @Column({ type: 'date', nullable: true })
  lastIssuedDate?: Date;

  @Column({ type: 'date', nullable: true })
  nextDueDate?: Date;

  @Column({ type: 'text', nullable: true, comment: 'Encrypted field' })
  clinicalIndication?: string;

  @Column({ type: 'text', nullable: true })
  specialInstructions?: string;

  @Column({ type: 'date', nullable: true })
  reviewDate?: Date;

  @Column({ type: 'boolean', default: false })
  requiresReview: boolean;

  @Column({ type: 'text', nullable: true })
  cancellationReason?: string;

  @Column({ type: 'date', nullable: true })
  cancelledDate?: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  cancelledBy?: string;

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

  @Column({ type: 'varchar', length: 255, nullable: true })
  deleted_by?: string;

  @ManyToOne(() => Prescription, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'originalPrescriptionId' })
  originalPrescription?: Prescription;
}
