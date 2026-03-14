import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { AuditEventType, AuditOutcome } from '../../../common/enums';

/**
 * AuditLog Entity
 * Immutable audit trail for HIPAA compliance and security tracking
 * Records all actions performed in the system with PHI access tracking
 *
 * Multi-tenant: workspaceId inherited from BaseEntity
 * HIPAA Compliance: Tracks patientId, justification, and access outcomes
 */
@Entity('audit_logs')
@Index('IDX_audit_logs_workspace_id', ['workspaceId'])
@Index('IDX_audit_logs_user_id', ['userId'])
@Index('IDX_audit_logs_patient_id', ['patientId'])
@Index('IDX_audit_logs_resource_type', ['resourceType'])
@Index('IDX_audit_logs_resource_id', ['resourceId'])
@Index('IDX_audit_logs_event_type', ['eventType'])
@Index('IDX_audit_logs_outcome', ['outcome'])
@Index('IDX_audit_logs_timestamp', ['timestamp'])
@Index('IDX_audit_logs_created_at', ['createdAt'])
@Index('IDX_audit_logs_composite', ['workspaceId', 'userId', 'eventType', 'timestamp'])
export class AuditLog extends BaseEntity {
  // Workspace ID for multi-tenancy (inherited from BaseEntity)
  @Column({ type: 'varchar', length: 255 })
  workspaceId: string;

  // User who performed the action
  @Column({ type: 'varchar', length: 255 })
  userId: string;

  // Action performed (e.g., "POST /api/patients", "UPDATE patient", etc.)
  @Column({ type: 'varchar', length: 500 })
  action: string;

  // Type of event (CREATE, READ, UPDATE, DELETE, etc.)
  @Column({
    type: 'enum',
    enum: AuditEventType,
    default: AuditEventType.OTHER,
  })
  eventType: AuditEventType;

  // Outcome of the action (SUCCESS, FAILURE)
  @Column({
    type: 'enum',
    enum: AuditOutcome,
    default: AuditOutcome.SUCCESS,
  })
  outcome: AuditOutcome;

  // Type of resource affected (e.g., "Patient", "Appointment", "CareNote")
  @Column({ type: 'varchar', length: 255, nullable: true })
  resourceType?: string;

  // ID of the resource affected
  @Column({ type: 'varchar', length: 255, nullable: true })
  resourceId?: string;

  // HIPAA Compliance: Patient ID for PHI access tracking
  @Column({ type: 'varchar', length: 255, nullable: true })
  patientId?: string;

  // HIPAA Compliance: Justification for accessing patient data
  @Column({ type: 'text', nullable: true })
  justification?: string;

  // Previous state before the action (JSON with PHI redaction)
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

  // New state after the action (JSON with PHI redaction)
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

  // Additional metadata (IP address, user agent, query params, etc.)
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

  // Timestamp of the action (separate from createdAt for precise tracking)
  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    precision: 6,
  })
  timestamp: Date;
}
