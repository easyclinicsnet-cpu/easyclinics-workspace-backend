import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { NoteAuditActionType } from '../../../common/enums';

/**
 * NoteAuditLog Entity
 * Specialized audit logging for clinical notes and care documentation
 * Tracks all modifications, approvals, sharing, and AI interactions with notes
 *
 * Multi-tenant: workspaceId inherited from BaseEntity
 * HIPAA Compliance: Complete audit trail of clinical documentation changes
 */
@Entity('note_audit_logs')
@Index('IDX_note_audit_logs_workspace_id', ['workspaceId'])
@Index('IDX_note_audit_logs_note_id', ['noteId'])
@Index('IDX_note_audit_logs_user_id', ['userId'])
@Index('IDX_note_audit_logs_action_type', ['actionType'])
@Index('IDX_note_audit_logs_created_at', ['createdAt'])
@Index('IDX_note_audit_logs_composite', ['workspaceId', 'noteId', 'actionType', 'createdAt'])
export class NoteAuditLog extends BaseEntity {
  // Workspace ID for multi-tenancy (inherited from BaseEntity)
  @Column({ type: 'varchar', length: 255 })
  workspaceId: string;

  // ID of the note being audited
  @Column({ type: 'uuid' })
  noteId: string;

  // User who performed the action
  @Column({ type: 'varchar', length: 255 })
  userId: string;

  // Type of action performed on the note
  @Column({
    type: 'enum',
    enum: NoteAuditActionType,
  })
  actionType: NoteAuditActionType;

  // List of fields that were changed (for UPDATE actions)
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
  changedFields?: string[];

  // Previous values of changed fields
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
  previousValues?: Record<string, any>;

  // New values of changed fields
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
  newValues?: Record<string, any>;

  // Additional metadata (version info, AI model used, sharing details, etc.)
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

  // IP address of the user
  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress?: string;

  // User agent of the client
  @Column({ type: 'text', nullable: true })
  userAgent?: string;

  // Comment or justification for the action
  @Column({ type: 'text', nullable: true })
  comment?: string;

  // Patient ID associated with the note (for cross-referencing)
  @Column({ type: 'varchar', length: 255, nullable: true })
  patientId?: string;

  // For AI-related actions, the AI provider used
  @Column({ type: 'varchar', length: 100, nullable: true })
  aiProvider?: string;

  // For sharing actions, the user or role shared with
  @Column({ type: 'varchar', length: 255, nullable: true })
  sharedWith?: string;

  // For permission changes, the old permission level
  @Column({ type: 'varchar', length: 50, nullable: true })
  oldPermission?: string;

  // For permission changes, the new permission level
  @Column({ type: 'varchar', length: 50, nullable: true })
  newPermission?: string;
}
