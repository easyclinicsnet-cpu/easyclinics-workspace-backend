import { Exclude, Expose, Type } from 'class-transformer';
import { AuditEventType, AuditOutcome } from '../../../common/enums';

/**
 * DTO for audit log responses
 * Excludes sensitive fields and transforms dates for API responses
 */
@Exclude()
export class AuditLogResponseDto {
  @Expose()
  id: string;

  @Expose()
  userId: string;

  @Expose()
  action: string;

  @Expose()
  eventType: AuditEventType;

  @Expose()
  outcome: AuditOutcome;

  @Expose()
  resourceType?: string;

  @Expose()
  resourceId?: string;

  @Expose()
  patientId?: string;

  @Expose()
  justification?: string;

  @Expose()
  previousState?: Record<string, any>;

  @Expose()
  newState?: Record<string, any>;

  @Expose()
  metadata?: Record<string, any>;

  @Expose()
  @Type(() => Date)
  timestamp: Date;

  @Expose()
  @Type(() => Date)
  createdAt: Date;

  // Exclude sensitive fields
  // workspaceId is excluded for security
  // deletedAt is excluded as audit logs should not be soft-deleted
}
