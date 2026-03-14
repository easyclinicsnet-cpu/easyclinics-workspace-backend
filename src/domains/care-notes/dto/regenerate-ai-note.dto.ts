import {
  IsOptional,
  IsString,
  IsEnum,
  IsNumber,
  IsInt,
  Min,
  Max,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CareNoteType, AIProvider } from '../../../common/enums';

export class RegenerateAiNoteDto {
  @ApiPropertyOptional({
    description:
      'User-edited source content to regenerate from. ' +
      'When provided this takes priority over the stored ai_note_source.sourceContent. ' +
      'In the edit flow the frontend always supplies this so the user\'s edits are respected.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  content?: string;

  @ApiPropertyOptional({ description: 'Override the note type', enum: CareNoteType })
  @IsOptional()
  @IsEnum(CareNoteType)
  noteType?: CareNoteType;

  @ApiPropertyOptional({ description: 'AI provider to use', enum: AIProvider })
  @IsOptional()
  @IsEnum(AIProvider)
  provider?: AIProvider;

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
  temperature?: number;

  @ApiPropertyOptional({ description: 'Maximum tokens for generation' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  maxTokens?: number;

  @ApiPropertyOptional({ description: 'Reason for regeneration (logged to audit)' })
  @IsOptional()
  @IsString()
  reason?: string;
}
