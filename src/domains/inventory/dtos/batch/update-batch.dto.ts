import {
  IsString, IsOptional, IsNumber, IsBoolean,
  IsUUID, IsDateString, Min, IsObject,
} from 'class-validator';

export class UpdateBatchDto {
  @IsNumber()
  @Min(0)
  @IsOptional()
  unitCost?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  sellingPrice?: number;

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

  @IsBoolean()
  @IsOptional()
  isQuarantined?: boolean;

  @IsString()
  @IsOptional()
  quarantineReason?: string;

  @IsString()
  @IsOptional()
  quarantineReleasedBy?: string;

  @IsString()
  @IsOptional()
  certificateOfAnalysis?: string;

  @IsString()
  @IsOptional()
  manufacturingLicense?: string;

  @IsString()
  @IsOptional()
  importPermitNumber?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;

  @IsString()
  @IsOptional()
  updatedBy?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
