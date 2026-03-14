import { InsuranceClaim } from '../../insurance/entities/insurance-claim.entity';
import { InsuranceClaimItem } from '../../insurance/entities/insurance-claim-item.entity';
import {
  ClaimResponseDto,
  InsuranceProviderResponseDto,
  PatientInsuranceResponseDto,
  ClaimSummaryResponseDto,
  ClaimItemResponseDto,
  CreateClaimWithItemsResponseDto,
  CreateClaimWithItemsResponseDataDto,
  ValidationResultResponseDto,
  ValidationResponseDto,
} from '../dto/insurance/appointment-claim.dto';
import { ClaimStatus } from '../dto/insurance/insurance-claim.dto';

/**
 * Mapper class for converting insurance claim entities to response DTOs.
 * All methods are static for stateless usage across the billing domain.
 */
export class ClaimResponseMapper {
  /**
   * Maps an InsuranceClaim entity to a ClaimResponseDto.
   * Expects the claim to have its relations (insuranceProvider, patientInsurance, claimItems) loaded.
   */
  static toClaimResponseDto(
    claim: InsuranceClaim,
    claimItems: InsuranceClaimItem[] = [],
  ): ClaimResponseDto {
    const dto = new ClaimResponseDto();

    dto.id = claim.id;
    dto.claimNumber = claim.claimNumber;
    dto.status = ClaimResponseMapper.mapClaimStatus(claim.status);
    dto.serviceStartDate = claim.serviceDate;
    dto.serviceTimeIn = claim.metadata?.serviceTimeIn ?? undefined;
    dto.serviceTimeOut = claim.metadata?.serviceTimeOut ?? undefined;
    dto.billId = claim.billId ?? '';
    dto.patientId = claim.patientId;
    dto.patientName = claim.patient?.id
      ? `${(claim.patient as any)?.firstName ?? ''} ${(claim.patient as any)?.lastName ?? ''}`.trim()
      : '';
    dto.diagnosis = claim.diagnosisDescription ?? claim.diagnosisCode;
    dto.insuranceProvider = ClaimResponseMapper.toInsuranceProviderDto(claim);
    dto.patientInsurance = ClaimResponseMapper.toPatientInsuranceDto(claim);
    dto.summary = ClaimResponseMapper.toClaimSummaryDto(claim, claimItems);
    dto.items = ClaimResponseMapper.toClaimItemsDto(claimItems);
    dto.approvedAmount = Number(claim.totalApprovedAmount);
    dto.patientResponsibility = Number(claim.patientResponsibilityAmount);
    dto.paidAmount = Number(claim.totalPaidAmount);
    dto.totalClaimedAmount = Number(claim.totalClaimedAmount);

    return dto;
  }

  /**
   * Maps claim insurance provider relation to InsuranceProviderResponseDto.
   */
  static toInsuranceProviderDto(claim: InsuranceClaim): InsuranceProviderResponseDto {
    const dto = new InsuranceProviderResponseDto();

    if (claim.insuranceProvider) {
      dto.id = claim.insuranceProvider.id;
      dto.name = claim.insuranceProvider.name;
    } else {
      dto.id = claim.insuranceProviderId;
      dto.name = '';
    }

    return dto;
  }

  /**
   * Maps claim patient insurance relation to PatientInsuranceResponseDto.
   */
  static toPatientInsuranceDto(claim: InsuranceClaim): PatientInsuranceResponseDto {
    const dto = new PatientInsuranceResponseDto();

    if (claim.patientInsurance) {
      dto.id = claim.patientInsurance.id;
      dto.schemeName = claim.patientInsurance.scheme?.schemeName ?? '';
      dto.membershipNumber = claim.patientInsurance.membershipNumber;
    } else {
      dto.id = claim.patientInsuranceId;
      dto.schemeName = '';
      dto.membershipNumber = '';
    }

    return dto;
  }

  /**
   * Builds a ClaimSummaryResponseDto from the claim and its items.
   */
  static toClaimSummaryDto(
    claim: InsuranceClaim,
    claimItems: InsuranceClaimItem[] = [],
  ): ClaimSummaryResponseDto {
    const dto = new ClaimSummaryResponseDto();

    dto.totalClaimedAmount = Number(claim.totalClaimedAmount);
    dto.itemCount = claimItems.length;
    dto.createdAt = claim.createdAt;

    if (claim.serviceDate && claim.serviceEndDate) {
      const start = new Date(claim.serviceDate).getTime();
      const end = new Date(claim.serviceEndDate).getTime();
      dto.serviceDuration = Math.max(0, Math.round((end - start) / (1000 * 60)));
    }

    return dto;
  }

  /**
   * Maps an array of InsuranceClaimItem entities to ClaimItemResponseDto[].
   */
  static toClaimItemsDto(claimItems: InsuranceClaimItem[] = []): ClaimItemResponseDto[] {
    return claimItems.map((item) => {
      const dto = new ClaimItemResponseDto();

      dto.id = item.id;
      dto.description = item.serviceDescription;
      dto.quantity = Number(item.quantity);
      dto.unitPrice = Number(item.unitPrice);
      dto.totalAmount = Number(item.claimedAmount) + Number(item.deniedAmount);
      dto.claimedAmount = Number(item.claimedAmount);
      dto.itemCategory = item.serviceCode;
      dto.procedureCode = item.procedureCode;
      dto.status = item.status;

      return dto;
    });
  }

  /**
   * Assembles a complete CreateClaimWithItemsResponseDto from a claim,
   * its items, and the amount/time validation results.
   */
  static toClaimWithItemsResponse(
    claim: InsuranceClaim,
    claimItems: InsuranceClaimItem[],
    amountValidation: { isValid: boolean; errors: string[] },
    timeValidation: { isValid: boolean; errors: string[] },
  ): CreateClaimWithItemsResponseDto {
    const claimDto = ClaimResponseMapper.toClaimResponseDto(claim, claimItems);

    const amountValidationDto = new ValidationResultResponseDto();
    amountValidationDto.isValid = amountValidation.isValid;
    amountValidationDto.errors = amountValidation.errors;

    const timeValidationDto = new ValidationResultResponseDto();
    timeValidationDto.isValid = timeValidation.isValid;
    timeValidationDto.errors = timeValidation.errors;

    const validationDto = new ValidationResponseDto();
    validationDto.amountValidation = amountValidationDto;
    validationDto.timeValidation = timeValidationDto;

    const dataDto = new CreateClaimWithItemsResponseDataDto();
    dataDto.claim = claimDto;
    dataDto.validation = validationDto;

    const responseDto = new CreateClaimWithItemsResponseDto();
    responseDto.success = amountValidation.isValid && timeValidation.isValid;
    responseDto.message =
      responseDto.success
        ? `Insurance claim ${claim.claimNumber} created successfully`
        : `Insurance claim ${claim.claimNumber} created with validation warnings`;
    responseDto.data = dataDto;

    return responseDto;
  }

  /**
   * Maps the InsuranceClaimStatus enum value to the ClaimStatus enum used in DTOs.
   */
  private static mapClaimStatus(status: string): ClaimStatus {
    const statusMap: Record<string, ClaimStatus> = {
      DRAFT: ClaimStatus.DRAFT,
      PENDING: ClaimStatus.PENDING,
      SUBMITTED: ClaimStatus.SUBMITTED,
      IN_REVIEW: ClaimStatus.IN_REVIEW,
      APPROVED: ClaimStatus.APPROVED,
      PARTIALLY_APPROVED: ClaimStatus.PARTIALLY_APPROVED,
      REJECTED: ClaimStatus.REJECTED,
      PAID: ClaimStatus.PAID,
      APPEALED: ClaimStatus.APPEALED,
      CANCELLED: ClaimStatus.CANCELLED,
      NOT_CLAIMED: ClaimStatus.PENDING,
      DENIED: ClaimStatus.REJECTED,
    };

    return statusMap[status] ?? ClaimStatus.PENDING;
  }
}
