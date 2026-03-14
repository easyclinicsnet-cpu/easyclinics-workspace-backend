import { IsString, IsEnum, IsOptional, IsObject, IsUUID } from 'class-validator';
import { AuditEventType, AuditOutcome } from '../../../common/enums';

/**
 * DTO for creating audit log entries
 * Used by services to log actions with HIPAA compliance tracking
 */
export class CreateAuditLogDto {
  @IsString()
  userId: string;

  @IsString()
  @IsOptional()
  action?: string;

  @IsEnum(AuditEventType)
  eventType: AuditEventType;

  @IsEnum(AuditOutcome)
  outcome: AuditOutcome;

  @IsString()
  @IsOptional()
  resourceType?: string;

  @IsString()
  @IsOptional()
  resourceId?: string;

  /** Alias for resourceType */
  @IsString()
  @IsOptional()
  entityType?: string;

  /** Alias for resourceId */
  @IsString()
  @IsOptional()
  entityId?: string;

  /** Optional workspaceId when passed inline */
  @IsString()
  @IsOptional()
  workspaceId?: string;

  @IsString()
  @IsOptional()
  patientId?: string;

  @IsString()
  @IsOptional()
  justification?: string;

  @IsObject()
  @IsOptional()
  previousState?: Record<string, any>;

  @IsObject()
  @IsOptional()
  newState?: Record<string, any>;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}
