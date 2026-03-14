import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { CareNote } from './care-note.entity';
import { PermissionLevel } from '../../../common/enums';
import { IsUUID } from 'class-validator';

/**
 * Care Note Permission Entity
 * Manages granular access control for care notes
 */
@Entity('care_note_permissions')
@Index('IDX_care_note_permissions_workspace', ['workspaceId'])
@Index('IDX_care_note_permissions_workspace_note', ['workspaceId', 'noteId'])
@Index('IDX_care_note_permissions_workspace_user', ['workspaceId', 'userId'])
@Index('IDX_care_note_permissions_workspace_role', ['workspaceId', 'role'])
@Index('IDX_care_note_permissions_workspace_level', ['workspaceId', 'permissionLevel'])
@Index('IDX_care_note_permissions_note_id', ['noteId'])
@Index('IDX_care_note_permissions_user_id', ['userId'])
@Index('IDX_care_note_permissions_role', ['role'])
@Index('IDX_care_note_permissions_granted_by', ['grantedBy'])
@Index('IDX_care_note_permissions_expires_at', ['expiresAt'])
@Index('IDX_care_note_permissions_created_at', ['createdAt'])
@Index('IDX_care_note_permissions_deleted_at', ['deletedAt'])
@Index('UQ_care_note_permissions_note_user', ['noteId', 'userId'], { unique: true })
export class CareNotePermission extends BaseEntity {
  // ===== MULTI-TENANCY =====
  @Column({ type: 'varchar', length: 255, nullable: false })
  @IsUUID()
  workspaceId!: string;

  @Column({ type: 'varchar', length: 255 })
  @IsUUID()
  noteId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  @IsUUID()
  userId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  role?: string;

  @Column({
    type: 'enum',
    enum: PermissionLevel,
    default: PermissionLevel.READ,
  })
  permissionLevel: PermissionLevel;

  @Column({ type: 'boolean', default: true })
  canView: boolean;

  @Column({ type: 'boolean', default: false })
  canEdit: boolean;

  @Column({ type: 'boolean', default: false })
  canDelete: boolean;

  @Column({ type: 'boolean', default: false })
  canShare: boolean;

  @Column({ type: 'varchar', length: 255 })
  grantedBy: string;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  expiresAt?: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  deleted_by?: string;

  @ManyToOne(() => CareNote, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'noteId' })
  note: CareNote;
}
