import { BillingAuditResponseDto } from './billing-audit-response.dto';
import { PaginatedResponseMetaDto } from '../common/pagination.dto';

export class PaginatedBillingAuditResponseDto {
  data: BillingAuditResponseDto[];
  meta: PaginatedResponseMetaDto;
}
