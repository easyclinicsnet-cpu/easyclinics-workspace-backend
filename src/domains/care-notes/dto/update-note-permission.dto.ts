import { IsEnum, IsOptional, IsDateString } from 'class-validator';
import { PermissionLevel } from '../../../common/enums';

export class UpdateNotePermissionDto {
  @IsOptional()
  @IsEnum(PermissionLevel)
  permissionLevel?: PermissionLevel;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
