import {
  IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber, IsBoolean,
  IsUUID, Min, IsArray, ValidateNested, IsObject, IsDateString, IsPositive,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiHideProperty, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ItemType } from '../../../../common/enums';
import { DispenseType, EmergencyLevel } from '../../enums';

export class DispenseItemDto {
  @IsUUID()
  @IsNotEmpty()
  itemId: string;

  @IsEnum(ItemType)
  @IsNotEmpty()
  itemType: ItemType;

  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @IsUUID()
  @IsOptional()
  batchId?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  priceOverride?: number;
}

export class DispenseRequestDto {
  @ApiHideProperty()
  @IsUUID()
  @IsOptional()
  workspaceId?: string; // injected from JWT — never sent by client

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DispenseItemDto)
  items: DispenseItemDto[];

  @IsEnum(DispenseType)
  @IsOptional()
  dispenseType?: DispenseType = DispenseType.FULL;

  @IsString()
  @IsNotEmpty()
  department: string;

  @IsUUID()
  @IsOptional()
  patientId?: string;

  @IsUUID()
  @IsOptional()
  prescriptionId?: string;

  @IsUUID()
  @IsOptional()
  appointmentId?: string;

  @IsString()
  @IsOptional()
  dispensedBy?: string;

  @IsString()
  @IsOptional()
  idempotencyKey?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}

export class EmergencyDispenseRequestDto extends DispenseRequestDto {
  @IsEnum(EmergencyLevel)
  @IsNotEmpty()
  emergencyLevel: EmergencyLevel;

  @IsString()
  @IsNotEmpty()
  authorizedBy: string;

  @IsString()
  @IsNotEmpty()
  justification: string;

  @IsBoolean()
  @IsOptional()
  overrideExpiry?: boolean;

  @IsBoolean()
  @IsOptional()
  overrideQuality?: boolean;
}

export class DispenseResponseDto {
  success: boolean;
  dispensedItems: DispensedItemResponseDto[];
  totalCost: number;
  warnings: string[];
  metadata?: Record<string, any>;
}

export class DispensedItemResponseDto {
  itemId: string;
  itemName: string;
  itemType: ItemType;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  batchId?: string;
  batchNumber?: string;
  isPartial: boolean;
  dispenseType: DispenseType;
}

// ─── History query / response ─────────────────────────────────────────────────

export class QueryDispenseHistoryDto {
  @ApiPropertyOptional({ description: 'Filter from date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Filter to date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Filter by patient UUID' })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({ description: 'Filter by appointment UUID' })
  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  @ApiHideProperty()
  @IsOptional()
  @IsUUID()
  billId?: string; // resolved internally from appointmentId — not exposed to clients

  @ApiHideProperty()
  @IsOptional()
  billConsumableItemIds?: string[]; // consumableItemIds from BillItems for this bill — not exposed to clients

  @ApiHideProperty()
  @IsOptional()
  billItemPricing?: Map<string, { unitPrice: number; total: number }>; // consumableItemId → pricing from BillItem — not exposed to clients

  @ApiPropertyOptional({ description: 'Filter by item UUID' })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({ enum: ItemType, description: 'Filter by item type' })
  @IsOptional()
  @IsEnum(ItemType)
  itemType?: ItemType;

  @ApiPropertyOptional({ enum: DispenseType, description: 'Filter by dispense type' })
  @IsOptional()
  @IsEnum(DispenseType)
  dispenseType?: DispenseType;

  @ApiPropertyOptional({ description: 'Filter by department' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1, minimum: 1 })
  @IsOptional()
  @IsPositive()
  @Transform(({ value }) => parseInt(value, 10))
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Results per page', default: 20, minimum: 1 })
  @IsOptional()
  @IsPositive()
  @Transform(({ value }) => parseInt(value, 10))
  @Type(() => Number)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Sort field', default: 'createdAt' })
  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'], default: 'DESC' })
  @IsOptional()
  @IsEnum(['ASC', 'DESC'])
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}

export class DispenseHistoryItemDto {
  @ApiProperty() id: string;
  @ApiProperty() recordType: 'MEDICATION_SALE' | 'PARTIAL_SALE' | 'CONSUMABLE_USAGE' | 'PARTIAL_USAGE';
  @ApiProperty() itemId: string;
  @ApiProperty() itemName: string;
  @ApiProperty({ enum: ItemType }) itemType: ItemType;
  @ApiProperty() quantity: number;
  @ApiProperty() unitPrice: number;
  @ApiProperty() totalAmount: number;
  @ApiPropertyOptional() batchId?: string;
  @ApiPropertyOptional() batchNumber?: string;
  @ApiPropertyOptional() patientId?: string;
  @ApiPropertyOptional() prescriptionId?: string;
  @ApiPropertyOptional() appointmentId?: string;
  @ApiProperty() department: string;
  @ApiProperty() dispensedBy: string;
  @ApiProperty({ enum: DispenseType }) dispenseType: DispenseType;
  @ApiProperty() timestamp: Date;
  @ApiPropertyOptional() metadata?: Record<string, any>;
}

export class PaginatedDispenseHistoryDto {
  @ApiProperty({ type: [DispenseHistoryItemDto] })
  data: DispenseHistoryItemDto[];

  @ApiProperty()
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
