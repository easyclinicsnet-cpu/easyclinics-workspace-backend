import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { CareNote } from './care-note.entity';

/**
 * Note Version Entity
 * Tracks version history of care notes
 */
@Entity('note_versions')
@Index('IDX_note_versions_workspace', ['workspaceId'])
@Index('IDX_note_versions_workspace_note', ['workspaceId', 'noteId'])
@Index('IDX_note_versions_workspace_version', ['workspaceId', 'versionNumber'])
@Index('IDX_note_versions_workspace_created_by', ['workspaceId', 'createdBy'])
@Index('IDX_note_versions_note_id', ['noteId'])
@Index('IDX_note_versions_version_number', ['versionNumber'])
@Index('IDX_note_versions_created_by', ['createdBy'])
@Index('IDX_note_versions_created_at', ['createdAt'])
@Index('IDX_note_versions_deleted_at', ['deletedAt'])
export class NoteVersion extends BaseEntity {
  // ===== MULTI-TENANCY =====
  @Column({ type: 'varchar', length: 255, nullable: false })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 255 })
  noteId: string;

  @Column({ type: 'int' })
  versionNumber: number;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'varchar', length: 255 })
  createdBy: string;

  @Column({ type: 'text', nullable: true })
  changeDescription?: string;

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

  @ManyToOne(() => CareNote, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'noteId' })
  note: CareNote;
}
