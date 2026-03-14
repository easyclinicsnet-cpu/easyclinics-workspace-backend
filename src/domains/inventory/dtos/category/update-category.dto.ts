import {
  IsString, IsOptional, IsEnum, IsBoolean,
  IsUUID, MaxLength, IsObject,
} from 'class-validator';
import { ItemType } from '../../../../common/enums';
import { IStorageConditions } from '../../interfaces';

export class UpdateCategoryDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  defaultUnit?: string;

  @IsUUID()
  @IsOptional()
  parentId?: string;

  @IsEnum(ItemType)
  @IsOptional()
  type?: ItemType;

  @IsObject()
  @IsOptional()
  storageConditions?: IStorageConditions;

  @IsBoolean()
  @IsOptional()
  requiresPrescriptionDefault?: boolean;

  @IsBoolean()
  @IsOptional()
  isControlledDefault?: boolean;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
