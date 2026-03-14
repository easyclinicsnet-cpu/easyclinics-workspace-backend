import {
  IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber, IsBoolean,
  IsUUID, IsDateString, Min, MaxLength, IsObject,
} from 'class-validator';
import { ItemType } from '../../../../common/enums';

export class CreateBatchDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  batchNumber: string;

  @IsEnum(ItemType)
  @IsNotEmpty()
  itemType: ItemType;

  @IsDateString()
  @IsNotEmpty()
  manufactureDate: string;

  @IsDateString()
  @IsNotEmpty()
  expiryDate: string;

  @IsNumber()
  @Min(0)
  initialQuantity: number;

  @IsNumber()
  @Min(0)
  unitCost: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  sellingPrice?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  totalPacks?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  packSize?: number;

  @IsString()
  @IsOptional()
  quantityUnit?: string;

  @IsBoolean()
  @IsOptional()
  isFractionalTracking?: boolean;

  @IsString()
  @IsOptional()
  location?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsBoolean()
  @IsOptional()
  isSterile?: boolean;

  @IsString()
  @IsOptional()
  sterilityIndicator?: string;

  @IsDateString()
  @IsOptional()
  sterilityExpiryDate?: string;

  @IsBoolean()
  @IsOptional()
  isQualityTested?: boolean;

  @IsDateString()
  @IsOptional()
  qualityTestDate?: string;

  @IsString()
  @IsOptional()
  qualityTestResult?: string;

  @IsString()
  @IsOptional()
  qualityTestNotes?: string;

  @IsString()
  @IsOptional()
  certificateOfAnalysis?: string;

  @IsString()
  @IsOptional()
  manufacturingLicense?: string;

  @IsString()
  @IsOptional()
  importPermitNumber?: string;

  @IsDateString()
  @IsOptional()
  receivedDate?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;

  @IsUUID()
  @IsOptional()
  medicationItemId?: string;

  @IsUUID()
  @IsOptional()
  consumableItemId?: string;

  @IsUUID()
  @IsOptional()
  supplierId?: string;

  @IsString()
  @IsOptional()
  createdBy?: string;
}
