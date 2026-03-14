import {
  IsUUID,
  IsEnum,
  IsString,
  IsOptional,
  MinLength,
  IsDateString,
} from 'class-validator';
import { ReferralUrgency } from '../../../common/enums';

export class CreateReferralLetterDto {
  @IsUUID()
  patientId: string;

  @IsOptional()
  @IsUUID()
  consultationId?: string;

  @IsString()
  @MinLength(1)
  referralType: string;

  @IsEnum(ReferralUrgency)
  urgency: ReferralUrgency;

  @IsString()
  @MinLength(1)
  clinicalSummary: string;

  @IsString()
  @MinLength(1)
  reasonForReferral: string;

  @IsOptional()
  @IsString()
  relevantHistory?: string;

  @IsOptional()
  @IsString()
  currentMedications?: string;

  @IsOptional()
  @IsString()
  allergies?: string;

  @IsOptional()
  @IsString()
  investigationsPerformed?: string;

  @IsOptional()
  @IsString()
  investigationResults?: string;

  @IsOptional()
  @IsString()
  provisionalDiagnosis?: string;

  @IsOptional()
  @IsString()
  referredTo?: string;

  @IsOptional()
  @IsString()
  referredToSpecialty?: string;

  @IsOptional()
  @IsDateString()
  appointmentDate?: string;
}
