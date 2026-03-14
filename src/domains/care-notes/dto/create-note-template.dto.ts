import {
  IsString,
  IsEnum,
  IsObject,
  IsOptional,
  IsBoolean,
  MinLength,
} from 'class-validator';
import { CareNoteType, TemplateCategory } from '../../../common/enums';

export class CreateNoteTemplateDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(TemplateCategory)
  category: TemplateCategory;

  @IsEnum(CareNoteType)
  noteType: CareNoteType;

  @IsObject()
  content: any;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean = false;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean = false;
}
