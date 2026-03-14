import { IsUUID, IsEnum, IsOptional, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PermissionLevel } from '../../../common/enums';

export class NotePermissionQueryDto {
  @IsOptional()
  @IsUUID()
  noteId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsEnum(PermissionLevel)
  permissionLevel?: PermissionLevel;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number = 20;
}
