import { IsString, IsEnum, IsOptional, IsInt, Min, Max, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { AuditEventType, AuditOutcome } from '../../../common/enums';

/**
 * DTO for querying audit logs with pagination, filtering, and sorting
 * Supports comprehensive audit trail retrieval for compliance and reporting
 */
export class QueryAuditLogsDto {
  // Pagination
  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page?: number = 1;

  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  @IsOptional()
  limit?: number = 20;

  // Filters
  @IsString()
  @IsOptional()
  userId?: string;

  @IsEnum(AuditEventType)
  @IsOptional()
  eventType?: AuditEventType;

  @IsEnum(AuditOutcome)
  @IsOptional()
  outcome?: AuditOutcome;

  @IsString()
  @IsOptional()
  resourceType?: string;

  @IsString()
  @IsOptional()
  resourceId?: string;

  @IsString()
  @IsOptional()
  patientId?: string;

  // Date range filtering
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  // Search term (searches in action, resourceType, etc.)
  @IsString()
  @IsOptional()
  search?: string;

  // Sorting
  @IsString()
  @IsOptional()
  sortBy?: 'timestamp' | 'eventType' | 'userId' | 'createdAt' = 'timestamp';

  @IsString()
  @IsOptional()
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}
