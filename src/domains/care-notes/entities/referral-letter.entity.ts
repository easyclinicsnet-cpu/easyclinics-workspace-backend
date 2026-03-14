import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { CareNote } from './care-note.entity';
import { ReferralStatus, ReferralUrgency } from '../../../common/enums';

/**
 * Referral Letter Entity
 * Medical referrals to specialists or other healthcare providers
 */
@Entity('referral_letters')
@Index('IDX_referral_letters_workspace', ['workspaceId'])
@Index('IDX_referral_letters_workspace_patient', ['workspaceId', 'patientId'])
@Index('IDX_referral_letters_workspace_doctor', ['workspaceId', 'referringDoctorId'])
@Index('IDX_referral_letters_workspace_status', ['workspaceId', 'status'])
@Index('IDX_referral_letters_workspace_urgency', ['workspaceId', 'urgency'])
@Index('IDX_referral_letters_workspace_specialty', ['workspaceId', 'specialty'])
@Index('IDX_referral_letters_patient_id', ['patientId'])
@Index('IDX_referral_letters_referring_doctor', ['referringDoctorId'])
@Index('IDX_referral_letters_status', ['status'])
@Index('IDX_referral_letters_urgency', ['urgency'])
@Index('IDX_referral_letters_specialty', ['specialty'])
@Index('IDX_referral_letters_note', ['noteId'])
@Index('IDX_referral_letters_consultation', ['consultationId'])
@Index('IDX_referral_letters_referral_date', ['referralDate'])
@Index('IDX_referral_letters_created_at', ['createdAt'])
@Index('IDX_referral_letters_deleted_at', ['deletedAt'])
export class ReferralLetter extends BaseEntity {
  // ===== MULTI-TENANCY =====
  @Column({ type: 'varchar', length: 255, nullable: false })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 255 })
  patientId: string;

  @Column({ type: 'varchar', length: 255 })
  referringDoctorId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  referredToId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  noteId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  consultationId?: string;

  @Column({
    type: 'enum',
    enum: ReferralStatus,
    default: ReferralStatus.DRAFT,
  })
  status: ReferralStatus;

  @Column({
    type: 'enum',
    enum: ReferralUrgency,
    default: ReferralUrgency.ROUTINE,
  })
  urgency: ReferralUrgency;

  @Column({ type: 'varchar', length: 255 })
  specialty: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  referredToName?: string;

  @Column({ type: 'text', nullable: true })
  referredToAddress?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  referredToContact?: string;

  @Column({ type: 'text', comment: 'Encrypted field' })
  reasonForReferral: string;

  @Column({ type: 'text', nullable: true, comment: 'Encrypted field' })
  clinicalHistory?: string;

  @Column({ type: 'text', nullable: true, comment: 'Encrypted field' })
  examinationFindings?: string;

  @Column({ type: 'text', nullable: true, comment: 'Encrypted field' })
  investigations?: string;

  @Column({ type: 'text', nullable: true, comment: 'Encrypted field' })
  currentMedications?: string;

  @Column({ type: 'text', nullable: true })
  additionalNotes?: string;

  @Column({ type: 'date', nullable: true })
  referralDate?: Date;

  @Column({ type: 'date', nullable: true })
  expectedAppointmentDate?: Date;

  @Column({ type: 'date', nullable: true })
  acknowledgedDate?: Date;

  @Column({ type: 'date', nullable: true })
  completedDate?: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  referenceNumber?: string;

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
  doctorId?: string;
  @Column({ type: 'varchar', length: 255, nullable: true })
  deleted_by?: string;

  @ManyToOne(() => CareNote, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'noteId' })
  note?: CareNote;
}
