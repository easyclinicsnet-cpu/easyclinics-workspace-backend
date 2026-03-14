import {
  IsUUID,
  IsEnum,
  IsOptional,
  IsDateString,
  IsString,
} from 'class-validator';
import { PermissionLevel } from '../../../common/enums';

export class CreateNotePermissionDto {
  @IsUUID()
  noteId: string;

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
