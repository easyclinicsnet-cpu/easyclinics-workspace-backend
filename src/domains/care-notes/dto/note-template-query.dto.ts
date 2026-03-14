import {
  IsEnum,
  IsOptional,
  IsBoolean,
  IsUUID,
  IsString,
  IsInt,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { CareNoteType, TemplateCategory } from '../../../common/enums';

export class NoteTemplateQueryDto {
  @IsOptional()
  @IsEnum(TemplateCategory)
  category?: TemplateCategory;

  @IsOptional()
  @IsEnum(CareNoteType)
  noteType?: CareNoteType;

  @IsOptional()
  @IsBoolean()
  @Transform(({ obj, key }) => { const v = (obj as Record<string, unknown>)[key as string]; return v === true || v === 'true'; })
  isPublic?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ obj, key }) => { const v = (obj as Record<string, unknown>)[key as string]; return v === true || v === 'true'; })
  isDefault?: boolean;

  @IsOptional()
  @IsUUID()
  createdBy?: string;

  @IsOptional()
  @IsString()
  search?: string;

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
