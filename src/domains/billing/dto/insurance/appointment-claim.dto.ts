import { InsuranceClaimStatus } from '../../../../common/enums';
import { ClaimStatus } from './insurance-claim.dto';

export class PatientInsuranceClaimDto {
  patientInsuranceId: string;
  insuranceProviderId: string;
  insuranceProviderName: string;
  insuranceProviderShortName: string;
  schemeId: string;
  schemeName: string;
  membershipNumber: string;
  policyNumber?: string;
  memberType: string;
  status: string;
  isPrimary: boolean;
  priority: number;
  coveragePercentage: number;
  annualLimit: number;
  authorizationNumber?: string;
  authorizationExpiryDate?: Date;
}

export class AppointmentClaimDataDto {
  serviceTimeIn: Date;
  serviceStartDate: Date;
  serviceTimeOut: Date;
  patientInsurance?: PatientInsuranceClaimDto;
  alternativeInsurances?: PatientInsuranceClaimDto[];
  diagnoses: string[];
  warnings?: string[];
}

export class InsuranceProviderResponseDto {
  id: string;
  name: string;
}

export class PatientInsuranceResponseDto {
  id: string;
  schemeName: string;
  membershipNumber: string;
}

export class ClaimItemResponseDto {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  claimedAmount: number;
  itemCategory: string;
  procedureCode?: string;
  status: InsuranceClaimStatus;
}

export class ClaimSummaryResponseDto {
  totalClaimedAmount: number;
  itemCount: number;
  serviceDuration?: number;
  createdAt: Date;
}

export class ValidationResultResponseDto {
  isValid: boolean;
  errors: string[];
  warnings?: string[];
}

export class ClaimResponseDto {
  id: string;
  claimNumber: string;
  status: ClaimStatus;
  serviceStartDate: Date;
  serviceTimeIn?: string;
  serviceTimeOut?: string;
  billId: string;
  patientId: string;
  patientName: string;
  diagnosis?: string;
  insuranceProvider: InsuranceProviderResponseDto;
  patientInsurance: PatientInsuranceResponseDto;
  summary: ClaimSummaryResponseDto;
  items: ClaimItemResponseDto[];
  approvedAmount?: number;
  patientResponsibility?: number;
  paidAmount?: number;
  totalClaimedAmount?: number;
}

export class ValidationResponseDto {
  amountValidation: ValidationResultResponseDto;
  timeValidation: ValidationResultResponseDto;
}

export class CreateClaimWithItemsResponseDataDto {
  claim: ClaimResponseDto;
  validation: ValidationResponseDto;
}

export class CreateClaimWithItemsResponseDto {
  success: boolean;
  message: string;
  data: CreateClaimWithItemsResponseDataDto;
}
