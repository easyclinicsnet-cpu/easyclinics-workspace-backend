import { ReferralStatus, ReferralUrgency } from '../../../common/enums';

export class ReferralLetterResponseDto {
  id: string;
  workspaceId: string;
  patientId: string;
  consultationId?: string;
  doctorId: string;
  referralType: string;
  urgency: ReferralUrgency;
  clinicalSummary: string;
  reasonForReferral: string;
  relevantHistory?: string;
  currentMedications?: string;
  allergies?: string;
  investigationsPerformed?: string;
  investigationResults?: string;
  provisionalDiagnosis?: string;
  referredTo?: string;
  referredToSpecialty?: string;
  appointmentDate?: Date;
  status: ReferralStatus;
  issuedAt?: Date;
  sentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;

  // Relations
  patient?: any;
  consultation?: any;
  doctor?: any;

  // Computed fields
  canEdit?: boolean;
  canIssue?: boolean;
  canSend?: boolean;
}
