import {
  IsString, IsOptional, IsEnum, IsNumber, IsBoolean,
  IsUUID, Min, MaxLength, IsObject,
} from 'class-validator';
import { MedicationForm, MedicationUnit } from '../../entities/medication-item.entity';
import { IStorageConditions, IMaterialComposition } from '../../interfaces';
import { SplitUnitDefinition } from '../../types';

export class UpdateMedicationItemDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  unitCost?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  sellingPrice?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  minimumStockLevel?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  reorderQuantity?: number;

  @IsEnum(MedicationForm)
  @IsOptional()
  form?: MedicationForm;

  @IsString()
  @IsOptional()
  barcode?: string;

  @IsEnum(MedicationUnit)
  @IsOptional()
  unitOfMeasure?: MedicationUnit;

  @IsBoolean()
  @IsOptional()
  requiresPrescription?: boolean;

  @IsBoolean()
  @IsOptional()
  isControlledSubstance?: boolean;

  @IsBoolean()
  @IsOptional()
  isHighRisk?: boolean;

  @IsBoolean()
  @IsOptional()
  isSingleUse?: boolean;

  @IsBoolean()
  @IsOptional()
  isSterile?: boolean;

  @IsBoolean()
  @IsOptional()
  isSplittable?: boolean;

  @IsNumber()
  @Min(0)
  @IsOptional()
  basePackSize?: number;

  @IsString()
  @IsOptional()
  basePackUnit?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  minimumDispenseQuantity?: number;

  @IsBoolean()
  @IsOptional()
  useOpenedPacksFirst?: boolean;

  @IsBoolean()
  @IsOptional()
  trackInBaseUnits?: boolean;

  @IsObject()
  @IsOptional()
  splitUnits?: SplitUnitDefinition[];

  @IsObject()
  @IsOptional()
  materialComposition?: IMaterialComposition;

  @IsObject()
  @IsOptional()
  storageConditions?: IStorageConditions;

  @IsObject()
  @IsOptional()
  storageOverrides?: IStorageConditions;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsUUID()
  @IsOptional()
  supplierId?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
