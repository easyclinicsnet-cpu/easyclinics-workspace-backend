import {
  IsUUID,
  IsEnum,
  IsArray,
  ValidateNested,
  IsOptional,
  IsDateString,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PermissionLevel } from '../../../common/enums';

export class SharePermissionDto {
  @IsUUID()
  userId: string;

  @IsEnum(PermissionLevel)
  permissionLevel: PermissionLevel;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class ShareCareNoteDto {
  @IsUUID()
  noteId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SharePermissionDto)
  sharedWith: SharePermissionDto[];
}
