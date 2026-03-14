import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { CareNote } from './care-note.entity';
import { AIProvider } from '../../../common/enums';
import { IsUUID } from 'class-validator';

/**
 * Care AI Note Source Entity
 * Tracks source data used for AI-generated care notes
 */
@Entity('care_ai_note_sources')
@Index('IDX_care_ai_note_sources_workspace', ['workspaceId'])
@Index('IDX_care_ai_note_sources_workspace_note', ['workspaceId', 'noteId'])
@Index('IDX_care_ai_note_sources_workspace_provider', ['workspaceId', 'aiProvider'])
@Index('IDX_care_ai_note_sources_workspace_source_type', ['workspaceId', 'sourceType'])
@Index('IDX_care_ai_note_sources_note_id', ['noteId'])
@Index('IDX_care_ai_note_sources_provider', ['aiProvider'])
@Index('IDX_care_ai_note_sources_source_type', ['sourceType'])
@Index('IDX_care_ai_note_sources_processed_at', ['processedAt'])
@Index('IDX_care_ai_note_sources_created_at', ['createdAt'])
@Index('IDX_care_ai_note_sources_deleted_at', ['deletedAt'])
export class CareAiNoteSource extends BaseEntity {
  // ===== MULTI-TENANCY =====
  @Column({ type: 'varchar', length: 255, nullable: false })
  @IsUUID()
  workspaceId!: string;

  @Column({ type: 'varchar', length: 255 })
  @IsUUID()
  noteId: string;

  @Column({
    type: 'enum',
    enum: AIProvider,
  })
  aiProvider: AIProvider;

  @Column({ type: 'varchar', length: 100 })
  sourceType: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  @IsUUID()
  sourceId?: string;

  @Column({ type: 'text', nullable: true })
  sourceContent?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  modelVersion?: string;

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
  processingMetadata?: any;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  confidenceScore?: number;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  processedAt?: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  recordingTranscriptId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  deleted_by?: string;

  @ManyToOne(() => CareNote, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'noteId' })
  note: CareNote;
}
