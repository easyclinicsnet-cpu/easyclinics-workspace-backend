import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { CareNote } from './care-note.entity';
import { IsUUID } from 'class-validator';
import { Consultation } from 'src/domains/consultations/entities';

/**
 * Care Note Timeline Entity
 * Tracks chronological events and milestones in patient care
 */
@Entity('care_note_timelines')
@Index('IDX_care_note_timelines_workspace', ['workspaceId'])
@Index('IDX_care_note_timelines_workspace_note', ['workspaceId', 'noteId'])
@Index('IDX_care_note_timelines_workspace_event_type', [
  'workspaceId',
  'eventType',
])
@Index('IDX_care_note_timelines_workspace_event_time', [
  'workspaceId',
  'eventTime',
])
@Index('IDX_care_note_timelines_workspace_created_by', [
  'workspaceId',
  'createdBy',
])
@Index('IDX_care_note_timelines_note_id', ['noteId'])
@Index('IDX_care_note_timelines_event_type', ['eventType'])
@Index('IDX_care_note_timelines_event_time', ['eventTime'])
@Index('IDX_care_note_timelines_created_by', ['createdBy'])
@Index('IDX_care_note_timelines_created_at', ['createdAt'])
@Index('IDX_care_note_timelines_deleted_at', ['deletedAt'])
export class CareNoteTimeline extends BaseEntity {
  // ===== MULTI-TENANCY =====
  @Column({ type: 'varchar', length: 255, nullable: false })
  @IsUUID()
  workspaceId!: string;

  @Column({ type: 'varchar', length: 255 })
  @IsUUID()
  noteId: string;

  @Column({ name: 'consultationId' })
  @IsUUID()
  consultationId!: string; 

  @Column({ type: 'varchar', length: 255 })
  eventType: string;

  @Column({ type: 'varchar', length: 500 })
  eventTitle: string;

  @Column({ type: 'text', nullable: true })
  eventDescription?: string;

  @Column({ type: 'datetime', precision: 6 })
  eventTime: Date;

  @Column({ type: 'varchar', length: 255 })
  createdBy: string;

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
  relatedEntityId?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  relatedEntityType?: string;


  @Column({ type: 'int', default: 0 })
  sequenceNumber: number;
  @Column({ type: 'varchar', length: 255, nullable: true })
  deleted_by?: string;

  @ManyToOne(() => CareNote, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'noteId' })
  note: CareNote;

  @ManyToOne(() => Consultation, (consultation) => consultation.noteTimelines)
  @JoinColumn({ name: 'consultationId' })
  consultation!: Consultation;
}

