import { Exclude, Expose, Type } from 'class-transformer';
import { AuditContextStatus } from '../../../common/enums';

/**
 * DTO for audit context responses
 * Exposes all fields with proper transformations
 */
@Exclude()
export class AuditContextResponseDto {
  @Expose()
  id: string;

  @Expose()
  contextId: string;

  @Expose()
  actionType: string;

  @Expose()
  status: AuditContextStatus;

  @Expose()
  userId: string;

  @Expose()
  entityType: string;

  @Expose()
  entityId: string;

  @Expose()
  previousState?: Record<string, any>;

  @Expose()
  newState?: Record<string, any>;

  @Expose()
  metadata?: Record<string, any>;

  @Expose()
  ipAddress?: string;

  @Expose()
  userAgent?: string;

  @Expose()
  reason?: string;

  @Expose()
  failureReason?: string;

  @Expose()
  @Type(() => Date)
  completedAt?: Date;

  @Expose()
  @Type(() => Date)
  createdAt: Date;

  @Expose()
  @Type(() => Date)
  updatedAt: Date;
}
