import {
  IsUUID,
  IsEnum,
  IsOptional,
  IsString,
  IsNumber,
  Min,
  Max,
  IsBoolean,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { AIProvider } from '../../../common/enums';

export class TranscribeAudioDto {
  @IsUUID()
  consultationId: string;

  @IsOptional()
  @IsEnum(AIProvider)
  provider?: AIProvider = AIProvider.OPENAI;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  language?: string = 'en';

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  @Type(() => Number)
  temperature?: number = 0.7;

  @IsOptional()
  @IsBoolean()
  @Transform(({ obj, key }) => { const v = (obj as Record<string, unknown>)[key as string]; return v === true || v === 'true'; })
  isBackgroundProcessing?: boolean = false;

  @IsOptional()
  @IsString()
  context?: string;

  @IsOptional()
  @IsString()
  patientName?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  audioDurationSeconds?: number;
}
