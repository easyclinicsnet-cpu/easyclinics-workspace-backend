import { Expose, Type } from 'class-transformer';
import { AuditLogResponseDto } from './audit-log-response.dto';

/**
 * DTO for paginated audit log responses
 * Returns audit logs with pagination metadata
 */
export class PaginatedAuditLogsResponseDto {
  @Expose()
  @Type(() => AuditLogResponseDto)
  data: AuditLogResponseDto[];

  @Expose()
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
