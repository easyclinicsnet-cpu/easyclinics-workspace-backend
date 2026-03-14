import { IsEnum, IsString, IsOptional, IsDateString } from 'class-validator';
import { ReferralUrgency } from '../../../common/enums';

export class UpdateReferralLetterDto {
  @IsOptional()
  @IsString()
  referralType?: string;

  @IsOptional()
  @IsEnum(ReferralUrgency)
  urgency?: ReferralUrgency;

  @IsOptional()
  @IsString()
  clinicalSummary?: string;

  @IsOptional()
  @IsString()
  reasonForReferral?: string;

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
