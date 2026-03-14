import {
  IsString, IsNotEmpty, IsOptional, IsEnum, IsBoolean,
  IsUUID, MaxLength, IsObject,
} from 'class-validator';
import { ItemType } from '../../../../common/enums';
import { IStorageConditions } from '../../interfaces';

export class CreateCategoryDto {
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

  @IsString()
  @IsOptional()
  defaultUnit?: string;

  @IsUUID()
  @IsOptional()
  parentId?: string;

  @IsEnum(ItemType)
  @IsOptional()
  type?: ItemType = ItemType.MEDICATION;

  @IsObject()
  @IsOptional()
  storageConditions?: IStorageConditions;

  @IsBoolean()
  @IsOptional()
  requiresPrescriptionDefault?: boolean;

  @IsBoolean()
  @IsOptional()
  isControlledDefault?: boolean;
}
