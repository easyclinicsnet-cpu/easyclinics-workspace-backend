import { IsString, IsOptional, IsDateString, IsUUID } from 'class-validator';
import { PaginationDto } from '../common/pagination.dto';

export class GetBillingAuditsDto extends PaginationDto {
  @IsString()
  @IsOptional()
  action?: string;

  @IsString()
  @IsOptional()
  resourceType?: string;

  @IsUUID()
  @IsOptional()
  resourceId?: string;

  @IsUUID()
  @IsOptional()
  userId?: string;

  @IsUUID()
  @IsOptional()
  patientId?: string;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;
}
