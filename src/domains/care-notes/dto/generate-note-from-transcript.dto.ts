import {
  IsUUID,
  IsEnum,
  IsOptional,
  IsString,
  IsNumber,
  IsInt,
  Min,
  Max,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CareNoteType, AIProvider } from '../../../common/enums';

export class GenerateNoteFromTranscriptDto {
  @ApiProperty({ description: 'Consultation ID', format: 'uuid' })
  @IsUUID()
  consultationId: string;

  @ApiPropertyOptional({ description: 'Transcript ID (optional — can generate from content alone)', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  transcriptId?: string;

  @ApiProperty({ description: 'Text content to generate the note from' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({ description: 'Type of clinical note to generate', enum: CareNoteType })
  @IsEnum(CareNoteType)
  noteType: CareNoteType;

  @ApiPropertyOptional({ description: 'Note template ID to use', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @ApiPropertyOptional({ description: 'AI provider to use', enum: AIProvider })
  @IsOptional()
  @IsEnum(AIProvider)
  provider?: AIProvider = AIProvider.OPENAI;

  @ApiPropertyOptional({ description: 'AI model override' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ description: 'Sampling temperature (0–2)', minimum: 0, maximum: 2 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  @Type(() => Number)
  temperature?: number = 0.7;

  @ApiPropertyOptional({ description: 'Maximum tokens for generation' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  maxTokens?: number;

  @ApiPropertyOptional({ description: 'Note title override' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'Patient ID for context', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({ description: 'Existing note ID to update', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  existingNoteId?: string;
}
