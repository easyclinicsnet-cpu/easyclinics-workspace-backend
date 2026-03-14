import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Consultation } from '../../consultations/entities/consultation.entity';
import { RecordingsTranscript } from './recordings-transcript.entity';
import { CareNoteType, CareNoteStatus } from '../../../common/enums';
import { IsUUID } from 'class-validator';

/**
 * Care Note Entity
 * Medical notes and documentation for patient consultations
 */
@Entity('care_notes')
@Index('IDX_care_notes_workspace', ['workspaceId'])
@Index('IDX_care_notes_workspace_consultation', ['workspaceId', 'consultationId'])
@Index('IDX_care_notes_workspace_author', ['workspaceId', 'authorId'])
@Index('IDX_care_notes_workspace_type', ['workspaceId', 'type'])
@Index('IDX_care_notes_workspace_status', ['workspaceId', 'status'])
@Index('IDX_care_notes_workspace_active', ['workspaceId', 'isLatestVersion'])
@Index('IDX_care_notes_consultation', ['consultationId'])
@Index('IDX_care_notes_author', ['authorId'])
@Index('IDX_care_notes_type', ['type'])
@Index('IDX_care_notes_status', ['status'])
@Index('IDX_care_notes_created_at', ['createdAt'])
@Index('IDX_care_notes_deleted_at', ['deletedAt'])
@Index('IDX_care_notes_version', ['version'])
@Index('IDX_care_notes_is_latest', ['isLatestVersion'])
export class CareNote extends BaseEntity {
  // ===== MULTI-TENANCY =====
  @Column({ type: 'varchar', length: 255, nullable: false })
  @IsUUID()
  workspaceId!: string;

  @Column({ type: 'varchar', length: 255 })
  @IsUUID()
  consultationId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  @IsUUID()
  recordingsTranscriptId?: string;

  @ManyToOne(() => RecordingsTranscript, { nullable: true, eager: false })
  @JoinColumn({ name: 'recordingsTranscriptId' })
  recordingsTranscript?: RecordingsTranscript;

  @Column({ type: 'varchar', length: 255 })
  @IsUUID()
  authorId: string;

  @Column({
    type: 'enum',
    enum: CareNoteType,
    default: CareNoteType.GENERAL_EXAMINATION,
  })
  type: CareNoteType;

  @Column({
    type: 'enum',
    enum: CareNoteStatus,
    default: CareNoteStatus.DRAFT,
  })
  status: CareNoteStatus;

  @Column({ type: 'text', nullable: true })
  content?: string;

  @Column({ type: 'boolean', default: false })
  isAiGenerated: boolean;

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
  aiMetadata?: any;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ type: 'boolean', default: false })
  isLatestVersion: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  previousVersionId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  @IsUUID()
  prescriptionId?: string;


  @Column({ type: 'int', default: 1, nullable: true })
  versionNumber?: number;
  @Column({ type: 'varchar', length: 255, nullable: true })
  deleted_by?: string;

  @ManyToOne(() => Consultation, (consultation) => consultation.notes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'consultationId' })
  consultation: Consultation;
}
