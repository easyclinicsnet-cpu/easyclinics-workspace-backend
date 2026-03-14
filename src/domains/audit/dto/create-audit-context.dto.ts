import { IsString, IsUUID, IsOptional, IsObject } from 'class-validator';

/**
 * DTO for creating audit context entries
 * Used to track complex operations and transactions
 */
export class CreateAuditContextDto {
  @IsUUID()
  contextId: string;

  @IsString()
  actionType: string;

  @IsString()
  userId: string;

  @IsString()
  entityType: string;

  @IsString()
  entityId: string;

  @IsObject()
  @IsOptional()
  previousState?: Record<string, any>;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  ipAddress?: string;

  @IsString()
  @IsOptional()
  userAgent?: string;
}
