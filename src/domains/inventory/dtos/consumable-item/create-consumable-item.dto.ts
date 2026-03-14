import {
  IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber, IsBoolean,
  IsUUID, Min, MaxLength, IsObject,
} from 'class-validator';
import { ItemType } from '../../../../common/enums';
import { ConsumableForm, ConsumableUnit } from '../../entities/consumable-item.entity';
import { IStorageConditions, IMaterialComposition } from '../../interfaces';
import { SplitUnitDefinition } from '../../types';

export class CreateConsumableItemDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(ItemType)
  @IsOptional()
  type?: ItemType = ItemType.CONSUMABLE;

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
  minimumStockLevel?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  reorderQuantity?: number;

  @IsEnum(ConsumableForm)
  @IsOptional()
  form?: ConsumableForm;

  @IsString()
  @IsOptional()
  barcode?: string;

  @IsEnum(ConsumableUnit)
  @IsOptional()
  unitOfMeasure?: ConsumableUnit;

  @IsBoolean()
  @IsOptional()
  isSingleUse?: boolean;

  @IsBoolean()
  @IsOptional()
  isSterile?: boolean;

  @IsBoolean()
  @IsOptional()
  isDisposable?: boolean;

  @IsBoolean()
  @IsOptional()
  isReusable?: boolean;

  @IsBoolean()
  @IsOptional()
  requiresSterilization?: boolean;

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
  @IsNotEmpty()
  categoryId: string;

  @IsUUID()
  @IsOptional()
  supplierId?: string;
}
