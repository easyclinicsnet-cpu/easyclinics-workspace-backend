import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { AuditContextStatus } from '../../../common/enums';

/**
 * AuditContext Entity
 * Tracks contextual information for complex transactions and operations
 * Used to capture complete audit trail for multi-step operations
 *
 * Multi-tenant: workspaceId inherited from BaseEntity
 * Use cases: Transaction tracking, rollback support, complex operation auditing
 */
@Entity('audit_contexts')
@Index('IDX_audit_contexts_workspace_id', ['workspaceId'])
@Index('IDX_audit_contexts_context_id', ['contextId'])
@Index('IDX_audit_contexts_user_id', ['userId'])
@Index('IDX_audit_contexts_entity_type', ['entityType'])
@Index('IDX_audit_contexts_entity_id', ['entityId'])
@Index('IDX_audit_contexts_status', ['status'])
@Index('IDX_audit_contexts_created_at', ['createdAt'])
@Index('IDX_audit_contexts_composite', ['workspaceId', 'userId', 'status', 'createdAt'])
export class AuditContext extends BaseEntity {
  // Workspace ID for multi-tenancy (inherited from BaseEntity)
  @Column({ type: 'varchar', length: 255 })
  workspaceId: string;

  // Unique context identifier for grouping related operations
  @Column({ type: 'uuid', unique: true })
  contextId: string;

  // Type of action (e.g., "BULK_UPDATE", "IMPORT", "MIGRATION")
  @Column({ type: 'varchar', length: 255 })
  actionType: string;

  // Status of the operation
  @Column({
    type: 'enum',
    enum: AuditContextStatus,
    default: AuditContextStatus.PENDING,
  })
  status: AuditContextStatus;

  // User who initiated the operation
  @Column({ type: 'varchar', length: 255 })
  userId: string;

  // Type of entity affected (e.g., "Patient", "Appointment")
  @Column({ type: 'varchar', length: 255 })
  entityType: string;

  // ID of the entity affected
  @Column({ type: 'varchar', length: 255 })
  entityId: string;

  // Previous state before the operation
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
  previousState?: Record<string, any>;

  // New state after the operation
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
  newState?: Record<string, any>;

  // Additional metadata (operation details, parameters, etc.)
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

  // Reason for the operation (user-provided justification)
  @Column({ type: 'text', nullable: true })
  reason?: string;

  // Failure reason if operation failed
  @Column({ type: 'text', nullable: true })
  failureReason?: string;

  // Timestamp when operation was completed or failed
  @Column({
    type: 'timestamp',
    nullable: true,
    precision: 6,
  })
  completedAt?: Date;

  /**
   * Capture the current state of the entity
   * @param state The state to capture
   */
  captureState(state: Record<string, any>): void {
    if (!this.previousState) {
      this.previousState = state;
    } else {
      this.newState = state;
    }
  }

  /**
   * Mark the context as completed
   */
  markCompleted(): void {
    this.status = AuditContextStatus.COMPLETED;
    this.completedAt = new Date();
  }

  /**
   * Mark the context as failed
   * @param reason The reason for failure
   */
  markFailed(reason: string): void {
    this.status = AuditContextStatus.FAILED;
    this.failureReason = reason;
    this.completedAt = new Date();
  }

  /**
   * Mark the context as reversed (rollback)
   */
  markReversed(): void {
    this.status = AuditContextStatus.REVERSED;
    this.completedAt = new Date();
  }
}
