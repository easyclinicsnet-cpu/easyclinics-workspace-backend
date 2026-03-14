import {
  IsOptional,
  IsArray,
  IsBoolean,
  IsString,
  IsNumber,
  Min,
  IsEnum,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ItemType } from '../../../../common/enums';

export class DropdownFilterDto {
  @ApiPropertyOptional({ description: 'Search by code, name, or description' })
  @IsOptional()
  @IsString()
  searchTerm?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Category IDs to filter by (includes nested)',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  categoryIds?: string[];

  @ApiPropertyOptional({ description: 'Filter by active status', default: true })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean = true;

  @ApiPropertyOptional({
    description: 'Only return items with available stock',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  hasStock?: boolean = true;

  @ApiPropertyOptional({ description: 'Filter by sterile requirement' })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  requireSterile?: boolean;

  @ApiPropertyOptional({
    description: 'Exclude controlled substances',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  excludeControlledSubstances?: boolean = false;

  @ApiPropertyOptional({ description: 'Filter by prescription requirement' })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  requiresPrescription?: boolean;

  @ApiPropertyOptional({ description: 'Filter by controlled substance status' })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isControlledSubstance?: boolean;

  @ApiPropertyOptional({ description: 'Max results to return', default: 100, minimum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  limit?: number = 100;

  @ApiPropertyOptional({ description: 'Pagination offset', default: 0, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  offset?: number = 0;

  @ApiPropertyOptional({ enum: ItemType, description: 'Filter by item type' })
  @IsOptional()
  @IsEnum(ItemType)
  itemType?: ItemType;

  @ApiPropertyOptional({ description: 'Return low stock items only', default: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  lowStockOnly?: boolean = false;

  @ApiPropertyOptional({ description: 'Return out-of-stock items only', default: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  outOfStockOnly?: boolean = false;
}

export class SearchInventoryDto extends DropdownFilterDto {
  @ApiProperty({ description: 'Required search term (code, name, or description)' })
  @IsString()
  declare searchTerm: string;
}

export class DispenseFilterDto extends DropdownFilterDto {
  @ApiPropertyOptional({
    description: 'Include batch details in the response',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  includeBatches?: boolean = true;

  @ApiPropertyOptional({
    description: 'Only return items that have at least one valid batch',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  onlyValidBatches?: boolean = true;

  @ApiPropertyOptional({
    description: 'Exclude expired batches from the batch list',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  excludeExpiredBatches?: boolean = true;
}

export class CategoryFilterDto {
  @ApiPropertyOptional({ enum: ItemType, description: 'Filter categories by item type' })
  @IsOptional()
  @IsEnum(ItemType)
  type?: ItemType;

  @ApiPropertyOptional({
    description: 'Include nested child categories in the response',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  includeChildren?: boolean = false;

  @ApiPropertyOptional({
    description: 'Include full category path in the response',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  includePath?: boolean = true;
}
