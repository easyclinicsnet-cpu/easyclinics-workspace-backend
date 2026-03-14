import {
  IsUUID,
  IsEnum,
  IsString,
  IsOptional,
  MinLength,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReferralUrgency } from '../../../common/enums';

/**
 * DTO for the AI-generate referral letter endpoint.
 *
 * Differs from CreateReferralLetterDto in that `clinicalSummary` and
 * `reasonForReferral` are optional — the AI extracts and composes them
 * from the linked care note / consultation.
 *
 * `noteId` is included so the AI can read the specific care note.
 */
export class GenerateReferralLetterDto {
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

  // ── Doctor-provided fields (required on this endpoint) ──────────────────────

  @ApiProperty({ description: 'Referral destination type (e.g. Cardiology, Physiotherapy)' })
  @IsString()
  @MinLength(1)
  referralType: string;

  @ApiProperty({ description: 'Referral urgency level', enum: ReferralUrgency })
  @IsEnum(ReferralUrgency)
  urgency: ReferralUrgency;

  // ── AI-generated fields (optional on this endpoint) ─────────────────────────

  @ApiPropertyOptional({ description: 'Clinical summary — AI generates from the care note if omitted' })
  @IsOptional()
  @IsString()
  clinicalSummary?: string;

  @ApiPropertyOptional({ description: 'Reason for referral — AI generates from the care note if omitted' })
  @IsOptional()
  @IsString()
  reasonForReferral?: string;

  // ── Optional supplementary fields ───────────────────────────────────────────

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  relevantHistory?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currentMedications?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  allergies?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  investigationsPerformed?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  investigationResults?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  provisionalDiagnosis?: string;

  @ApiPropertyOptional({ description: 'Referred-to doctor or facility name' })
  @IsOptional()
  @IsString()
  referredTo?: string;

  @ApiPropertyOptional({ description: 'Referred-to specialty' })
  @IsOptional()
  @IsString()
  referredToSpecialty?: string;

  @ApiPropertyOptional({ description: 'Requested appointment date ISO 8601' })
  @IsOptional()
  @IsDateString()
  appointmentDate?: string;
}
