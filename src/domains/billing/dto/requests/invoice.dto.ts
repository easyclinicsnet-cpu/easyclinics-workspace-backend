import {
  IsString,
  IsOptional,
  IsEnum,
  IsUUID,
  IsDateString,
} from 'class-validator';
import { BillStatus } from '../../../../common/enums';
import { PaginationDto } from '../common/pagination.dto';

export class CreateInvoiceDto {
  @IsUUID()
  billId: string;

  @IsUUID()
  patientId: string;

  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  terms?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}

export class UpdateInvoiceDto {
  @IsEnum(BillStatus)
  @IsOptional()
  status?: BillStatus;

  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  terms?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}

export class InvoiceQueryDto extends PaginationDto {
  @IsUUID()
  @IsOptional()
  billId?: string;

  @IsUUID()
  @IsOptional()
  patientId?: string;

  @IsEnum(BillStatus)
  @IsOptional()
  status?: BillStatus;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;
}
