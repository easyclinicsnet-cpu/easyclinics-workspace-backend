import {
  IsString,
  IsEnum,
  IsObject,
  IsOptional,
  IsBoolean,
} from 'class-validator';
import { CareNoteType, TemplateCategory } from '../../../common/enums';

export class UpdateNoteTemplateDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(TemplateCategory)
  category?: TemplateCategory;

  @IsOptional()
  @IsEnum(CareNoteType)
  noteType?: CareNoteType;

  @IsOptional()
  @IsObject()
  content?: any;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
