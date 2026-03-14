import {
  IsUUID,
  IsString,
  IsOptional,
  IsBoolean,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

/**
 * DTO for the AI-generate sick note endpoint.
 *
 * Differs from CreateSickNoteDto in that `diagnosis` is optional — the AI
 * extracts it from the linked care note / consultation.  All other fields
 * follow the same rules as the manual-create DTO.
 */
export class GenerateSickNoteDto {
  @ApiProperty({ description: 'Patient UUID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: 'Linked care note UUID — used by AI to read clinical content' })
  @IsOptional()
  @IsUUID()
  noteId?: string;

  @ApiPropertyOptional({ description: 'Linked consultation UUID' })
  @IsOptional()
  @IsUUID()
  consultationId?: string;

  // ── AI-generated fields (optional on this endpoint) ─────────────────────────

  @ApiPropertyOptional({ description: 'Diagnosis — AI generates this from the care note if omitted' })
  @IsOptional()
  @IsString()
  diagnosis?: string;

  @ApiPropertyOptional({ description: 'Clinical recommendations — AI generates if omitted' })
  @IsOptional()
  @IsString()
  recommendations?: string;

  // ── Doctor-provided fields (still validated when present) ───────────────────

  @ApiPropertyOptional({ description: 'Issue date ISO 8601 — defaults to today' })
  @IsOptional()
  @IsDateString()
  issueDate?: string;

  @ApiProperty({ description: 'Leave start date ISO 8601' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: 'Leave end date ISO 8601' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({ description: 'Employer name the note is addressed to' })
  @IsOptional()
  @IsString()
  employerName?: string;

  @ApiPropertyOptional({ description: 'Employer address' })
  @IsOptional()
  @IsString()
  employerAddress?: string;

  @ApiPropertyOptional({ description: 'Patient is fit for light duties', default: false })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true')
  isFitForLightDuties?: boolean;

  @ApiPropertyOptional({ description: 'Description of light duties (when isFitForLightDuties is true)' })
  @IsOptional()
  @IsString()
  lightDutiesDescription?: string;

  @ApiPropertyOptional({ description: 'Pre-assigned certificate number (auto-generated on issue if omitted)' })
  @IsOptional()
  @IsString()
  certificateNumber?: string;
}
