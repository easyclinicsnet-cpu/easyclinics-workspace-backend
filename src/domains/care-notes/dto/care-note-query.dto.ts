import {
  IsUUID,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsString,
  IsDateString,
  IsInt,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { CareNoteType, CareNoteStatus } from '../../../common/enums';

export class CareNoteQueryDto {
  @IsOptional()
  @IsUUID()
  consultationId?: string;

  @IsOptional()
  @IsEnum(CareNoteType)
  type?: CareNoteType;

  @IsOptional()
  @IsEnum(CareNoteStatus)
  status?: CareNoteStatus;

  @IsOptional()
  @IsUUID()
  authorId?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ obj, key }) => { const v = (obj as Record<string, unknown>)[key as string]; return v === true || v === 'true'; })
  isAiGenerated?: boolean;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

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

  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @IsOptional()
  @IsEnum(['ASC', 'DESC'])
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}
