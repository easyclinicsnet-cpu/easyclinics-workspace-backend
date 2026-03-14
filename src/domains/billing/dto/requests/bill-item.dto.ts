import {
  IsString,
  IsOptional,
  IsNumber,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateBillItemDto {
  @IsUUID()
  billId: string;

  @IsString()
  description: string;

  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;

  @IsString()
  @IsOptional()
  department?: string;

  @IsUUID()
  @IsOptional()
  medicationItemId?: string;

  @IsUUID()
  @IsOptional()
  consumableItemId?: string;

  @IsUUID()
  @IsOptional()
  batchId?: string;

  @IsNumber()
  @IsOptional()
  actualUnitCost?: number;

  @IsOptional()
  metadata?: Record<string, any>;
}

export class UpdateBillItemDto {
  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(0.0001)
  @IsOptional()
  quantity?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  unitPrice?: number;

  @IsString()
  @IsOptional()
  department?: string;

  @IsUUID()
  @IsOptional()
  batchId?: string;

  @IsNumber()
  @IsOptional()
  actualUnitCost?: number;

  @IsOptional()
  metadata?: Record<string, any>;
}
