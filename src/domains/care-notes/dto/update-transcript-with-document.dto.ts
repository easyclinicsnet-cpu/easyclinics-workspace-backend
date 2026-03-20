/**
 * DTO for updating an existing transcript with document content.
 *
 * Mirrors UpdateTranscriptWithAudioDto — either transcriptId (update existing)
 * or aiNoteSourceId (create from AI note source) must be provided.
 */

import {
  IsOptional,
  IsUUID,
  IsIn,
  IsString,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class UpdateTranscriptWithDocumentDto {
  @ApiPropertyOptional({ description: 'Existing transcript ID to update' })
  @IsOptional()
  @IsUUID()
  transcriptId?: string;

  @ApiPropertyOptional({ description: 'AI note source ID to create new transcript from' })
  @IsOptional()
  @IsUUID()
  aiNoteSourceId?: string;

  @ApiPropertyOptional({ description: 'Consultation ID' })
  @IsOptional()
  @IsUUID()
  consultationId?: string;

  @ApiPropertyOptional({
    description: 'Merge strategy: append (default) or replace. Alias for "strategy".',
    enum: ['append', 'replace'],
    default: 'append',
  })
  @IsOptional()
  @IsIn(['append', 'replace'])
  mergeStrategy?: string;

  @ApiPropertyOptional({
    description: 'Merge strategy (alias accepted by the Flutter client)',
    enum: ['append', 'replace'],
  })
  @IsOptional()
  @IsIn(['append', 'replace'])
  strategy?: string;

  @ApiPropertyOptional({ description: 'Optional context to guide AI structuring' })
  @IsOptional()
  @IsString()
  context?: string;

  @ApiPropertyOptional({ description: 'AI provider to use for image analysis or structuring' })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({ description: 'AI model override' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ description: 'Language code', default: 'en' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({ description: 'AI temperature (0–2)', default: 0.7 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  @Transform(({ value }) => (value !== undefined ? parseFloat(value) : undefined))
  temperature?: number;
}
