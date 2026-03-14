import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  IsUUID,
  IsDateString,
  IsArray,
  ValidateNested,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { BillStatus } from '../../../../common/enums';
import { PaginationDto } from '../common/pagination.dto';
import { CreateBillItemDto } from './bill-item.dto';

export class CreateBillDto {
  @IsUUID()
  patientId: string;

  @IsUUID()
  appointmentId: string;

  @IsString()
  @IsOptional()
  department?: string;

  @IsUUID()
  @IsOptional()
  discountId?: string;

  @IsUUID()
  @IsOptional()
  taxId?: string;

  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBillItemDto)
  @IsOptional()
  items?: CreateBillItemDto[];

  @IsOptional()
  metadata?: Record<string, any>;
}

export class UpdateBillDto {
  @IsString()
  @IsOptional()
  department?: string;

  @IsUUID()
  @IsOptional()
  discountId?: string;

  @IsUUID()
  @IsOptional()
  taxId?: string;

  @IsEnum(BillStatus)
  @IsOptional()
  status?: BillStatus;

  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}

export class BillQueryDto extends PaginationDto {
  @IsUUID()
  @IsOptional()
  patientId?: string;

  @IsEnum(BillStatus)
  @IsOptional()
  status?: BillStatus;

  @IsString()
  @IsOptional()
  department?: string;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsOptional()
  @Transform(({ obj, key }) => { const v = (obj as Record<string, unknown>)[key as string]; return v === true || v === 'true'; })
  overdue?: boolean;
}
