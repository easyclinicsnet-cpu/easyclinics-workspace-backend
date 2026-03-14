import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { CareNote } from './care-note.entity';
import { SickNoteStatus } from '../../../common/enums';

/**
 * Sick Note Entity
 * Medical certificates for work/school absence
 */
@Entity('sick_notes')
@Index('IDX_sick_notes_workspace', ['workspaceId'])
@Index('IDX_sick_notes_workspace_patient', ['workspaceId', 'patientId'])
@Index('IDX_sick_notes_workspace_doctor', ['workspaceId', 'doctorId'])
@Index('IDX_sick_notes_workspace_status', ['workspaceId', 'status'])
@Index('IDX_sick_notes_workspace_issue_date', ['workspaceId', 'issueDate'])
@Index('IDX_sick_notes_patient_id', ['patientId'])
@Index('IDX_sick_notes_doctor_id', ['doctorId'])
@Index('IDX_sick_notes_status', ['status'])
@Index('IDX_sick_notes_issue_date', ['issueDate'])
@Index('IDX_sick_notes_start_date', ['startDate'])
@Index('IDX_sick_notes_end_date', ['endDate'])
@Index('IDX_sick_notes_note', ['noteId'])
@Index('IDX_sick_notes_consultation', ['consultationId'])
@Index('IDX_sick_notes_created_at', ['createdAt'])
@Index('IDX_sick_notes_deleted_at', ['deletedAt'])
export class SickNote extends BaseEntity {
  // ===== MULTI-TENANCY =====
  @Column({ type: 'varchar', length: 255, nullable: false })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 255 })
  patientId: string;

  @Column({ type: 'varchar', length: 255 })
  doctorId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  noteId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  consultationId?: string;

  @Column({
    type: 'enum',
    enum: SickNoteStatus,
    default: SickNoteStatus.DRAFT,
  })
  status: SickNoteStatus;

  @Column({ type: 'date' })
  issueDate: Date;

  @Column({ type: 'date' })
  startDate: Date;

  @Column({ type: 'date' })
  endDate: Date;

  @Column({ type: 'int' })
  durationDays: number;

  @Column({ type: 'text', comment: 'Encrypted field' })
  diagnosis: string;

  @Column({ type: 'text', nullable: true, comment: 'Encrypted field' })
  recommendations?: string;

  @Column({ type: 'text', nullable: true })
  employerName?: string;

  @Column({ type: 'text', nullable: true })
  employerAddress?: string;

  @Column({ type: 'boolean', default: false })
  isFitForLightDuties: boolean;

  @Column({ type: 'text', nullable: true })
  lightDutiesDescription?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  certificateNumber?: string;

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

  @ManyToOne(() => CareNote, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'noteId' })
  note?: CareNote;
}
