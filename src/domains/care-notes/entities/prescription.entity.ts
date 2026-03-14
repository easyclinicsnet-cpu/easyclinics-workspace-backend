import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Consultation } from '../../consultations/entities/consultation.entity';
import { CareNote } from './care-note.entity';

/**
 * Prescription Entity
 * Medication prescriptions for patients
 */
@Entity('prescriptions')
@Index('IDX_prescriptions_workspace', ['workspaceId'])
@Index('IDX_prescriptions_workspace_appointment', ['workspaceId', 'appointmentId'])
@Index('IDX_prescriptions_workspace_consultation', ['workspaceId', 'consultationId'])
@Index('IDX_prescriptions_workspace_doctor', ['workspaceId', 'doctorId'])
@Index('IDX_prescriptions_workspace_note', ['workspaceId', 'noteId'])
@Index('IDX_prescriptions_appointment', ['appointmentId'])
@Index('IDX_prescriptions_consultation', ['consultationId'])
@Index('IDX_prescriptions_doctor', ['doctorId'])
@Index('IDX_prescriptions_note', ['noteId'])
@Index('IDX_prescriptions_created_at', ['createdAt'])
@Index('IDX_prescriptions_deleted_at', ['deletedAt'])
export class Prescription extends BaseEntity {
  // ===== MULTI-TENANCY =====
  @Column({ type: 'varchar', length: 255, nullable: false })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 255, comment: 'Encrypted field' })
  medicine: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: 'Encrypted field' })
  dose?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: 'Encrypted field' })
  route?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: 'Encrypted field' })
  frequency?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: 'Encrypted field' })
  days?: string;

  @Column({ type: 'varchar', length: 255 })
  appointmentId: string;

  @Column({ type: 'varchar', length: 255 })
  consultationId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  noteId?: string;

  @Column({ type: 'varchar', length: 255 })
  doctorId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  deleted_by?: string;

  @ManyToOne(() => Consultation, (consultation) => consultation.prescriptions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'consultationId' })
  consultation: Consultation;

  @ManyToOne(() => CareNote, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'noteId' })
  note?: CareNote;
}
