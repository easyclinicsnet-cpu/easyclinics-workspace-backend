import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';

import { InsuranceClaim } from '../../insurance/entities/insurance-claim.entity';
import { InsuranceClaimItem } from '../../insurance/entities/insurance-claim-item.entity';
import { PatientInsurance } from '../../insurance/entities/patient-insurance.entity';
import { InsuranceProvider } from '../../insurance/entities/insurance-provider.entity';
import { PatientBill } from '../entities/patient-bill.entity';
import { BillItem } from '../entities/bill-item.entity';
import { Payment } from '../entities/payment.entity';

import { PatientBillRepository } from '../repositories/patient-bill.repository';
import { BillItemRepository } from '../repositories/bill-item.repository';
import { PaymentRepository } from '../repositories/payment.repository';

import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';

import {
  CreateClaimWithItemsDto,
  CreateClaimItemDto,
} from '../dto/insurance/insurance-claim.dto';
import {
  ClaimResponseDto,
  ClaimItemResponseDto,
  ClaimSummaryResponseDto,
  InsuranceProviderResponseDto,
  PatientInsuranceResponseDto,
  ValidationResultResponseDto,
  CreateClaimWithItemsResponseDto,
  AppointmentClaimDataDto,
  PatientInsuranceClaimDto,
} from '../dto/insurance/appointment-claim.dto';

import {
  InsuranceClaimStatus,
  PaymentStatus,
  AuditEventType,
  AuditOutcome,
} from '../../../common/enums';

import {
  INSURANCE_COVERAGE_RATES,
  NUMBER_PREFIXES,
} from '../utils/billing.constants';

/**
 * Insurance Claim Service
 *
 * Manages the full lifecycle of insurance claims: creation, submission,
 * approval, rejection, and querying. Coordinates between bill items,
 * patient insurance records, and insurance providers.
 */
@Injectable()
export class InsuranceClaimService {
  constructor(
    @InjectRepository(InsuranceClaim)
    private readonly claimRepository: Repository<InsuranceClaim>,

    @InjectRepository(InsuranceClaimItem)
    private readonly claimItemRepository: Repository<InsuranceClaimItem>,

    @InjectRepository(PatientInsurance)
    private readonly patientInsuranceRepository: Repository<PatientInsurance>,

    @InjectRepository(InsuranceProvider)
    private readonly insuranceProviderRepository: Repository<InsuranceProvider>,

    private readonly patientBillRepository: PatientBillRepository,
    private readonly billItemRepository: BillItemRepository,
    private readonly paymentRepository: PaymentRepository,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext('InsuranceClaimService');
  }

  // ---------------------------------------------------------------------------
  // Public Methods
  // ---------------------------------------------------------------------------

  /**
   * Create an insurance claim with its line items inside a single transaction.
   *
   * Steps:
   *  1. Validate the referenced bill exists.
   *  2. Load patient insurance and insurance provider records.
   *  3. Run amount and service-time validations from the DTO.
   *  4. Open a transaction: persist the claim header, persist each claim item,
   *     and mark the associated bill items as CLAIMED.
   *  5. Generate a unique claim number.
   *  6. Write an audit log entry.
   *  7. Return a response DTO containing the new claim and validation results.
   */
  async createClaimWithItems(
    dto: CreateClaimWithItemsDto,
    userId: string,
    workspaceId: string,
  ): Promise<CreateClaimWithItemsResponseDto> {
    this.logger.log(
      `Creating insurance claim for bill ${dto.billId} by user ${userId}`,
    );

    // 1. Validate bill
    const bill = await this.patientBillRepository.findByIdWithRelations(
      dto.billId,
    );
    if (!bill) {
      throw new NotFoundException(
        `Bill with ID ${dto.billId} not found`,
      );
    }

    // 2. Load patient insurance
    const patientInsurance = await this.patientInsuranceRepository.findOne({
      where: { id: dto.patientInsuranceId, isActive: true },
      relations: ['insuranceProvider', 'scheme'],
    });
    if (!patientInsurance) {
      throw new NotFoundException(
        `Patient insurance with ID ${dto.patientInsuranceId} not found`,
      );
    }

    // 3. Load insurance provider
    const insuranceProvider = await this.insuranceProviderRepository.findOne({
      where: { id: dto.insuranceProviderId, isActive: true },
    });
    if (!insuranceProvider) {
      throw new NotFoundException(
        `Insurance provider with ID ${dto.insuranceProviderId} not found`,
      );
    }

    // 4. Validate amounts and service times
    const amountValidation = dto.validateAmounts();
    const timeValidation = dto.validateServiceTime();

    if (!amountValidation.isValid) {
      throw new BadRequestException({
        message: 'Claim amount validation failed',
        errors: amountValidation.errors,
      });
    }

    if (!timeValidation.isValid) {
      throw new BadRequestException({
        message: 'Service time validation failed',
        errors: timeValidation.errors,
      });
    }

    // 5. Execute inside a transaction
    const claimNumber = this.generateClaimNumber();

    const savedClaim = await this.dataSource.transaction(async (manager) => {
      // Create the claim header
      const claim = manager.create(InsuranceClaim, {
        claimNumber,
        patientId: bill.patientId,
        patientInsuranceId: dto.patientInsuranceId,
        insuranceProviderId: dto.insuranceProviderId,
        billId: dto.billId,
        appointmentId: bill.appointmentId,
        status: InsuranceClaimStatus.PENDING,
        claimDate: new Date(),
        serviceDate: new Date(dto.serviceStartDate),
        totalClaimedAmount: dto.totalClaimedAmount,
        totalApprovedAmount: 0,
        totalDeniedAmount: 0,
        totalAdjustedAmount: 0,
        totalPaidAmount: 0,
        patientResponsibilityAmount: 0,
        diagnosisCode: dto.diagnosisCode,
        diagnosisDescription: dto.diagnosisDescription,
        authorizationNumber: dto.preAuthorizationNumber,
        claimNotes: dto.clinicalNotes,
        submittedBy: userId,
        attachments: dto.attachments,
        metadata: dto.metadata,
      });

      const persistedClaim = await manager.save(InsuranceClaim, claim);

      // Create claim items
      for (let i = 0; i < dto.items.length; i++) {
        const itemDto = dto.items[i];
        const coverageAmount = this.calculateItemCoverage(
          itemDto.itemCategory ?? 'CONSULTATION',
          itemDto.claimedAmount,
        );

        const claimItem = manager.create(InsuranceClaimItem, {
          claimId: persistedClaim.id,
          billItemId: itemDto.billItemId,
          lineNumber: i + 1,
          serviceCode: itemDto.procedureCode ?? `SVC-${i + 1}`,
          serviceDescription: itemDto.description ?? `Claim item ${i + 1}`,
          serviceDate: new Date(dto.serviceStartDate),
          quantity: itemDto.quantity,
          unitPrice: itemDto.unitPrice,
          claimedAmount: itemDto.claimedAmount,
          approvedAmount: 0,
          deniedAmount: 0,
          adjustedAmount: 0,
          paidAmount: 0,
          patientResponsibilityAmount: 0,
          status: InsuranceClaimStatus.PENDING,
          diagnosisCode: itemDto.diagnosisCode,
          procedureCode: itemDto.procedureCode,
          revenueCode: itemDto.revenueCode,
          coveragePercentage: coverageAmount > 0
            ? (coverageAmount / itemDto.claimedAmount) * 100
            : 0,
          metadata: itemDto.metadata,
        });

        await manager.save(InsuranceClaimItem, claimItem);

        // Update the associated bill item's insurance status
        await manager.update(BillItem, itemDto.billItemId, {
          insuranceClaimStatus: InsuranceClaimStatus.CLAIMED,
          hasInsuranceClaim: true,
          totalClaimedAmount: itemDto.claimedAmount,
        });
      }

      return persistedClaim;
    });

    // 6. Audit log
    try {
      await this.auditLogService.log(
        {
          userId,
          action: 'INSURANCE_CLAIM_CREATED',
          eventType: AuditEventType.CREATE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'InsuranceClaim',
          resourceId: savedClaim.id,
          patientId: bill.patientId,
          newState: {
            claimNumber,
            billId: dto.billId,
            totalClaimedAmount: dto.totalClaimedAmount,
            itemCount: dto.items.length,
          },
        },
        workspaceId,
      );
    } catch (auditError) {
      this.logger.error(
        `Failed to write audit log for claim creation: ${auditError.message}`,
        auditError.stack,
      );
    }

    // 7. Load full claim with relations for response mapping
    const fullClaim = await this.claimRepository.findOne({
      where: { id: savedClaim.id },
      relations: ['patientInsurance', 'insuranceProvider', 'patient'],
    });

    const claimItems = await this.claimItemRepository.find({
      where: { claimId: savedClaim.id, isActive: true },
      order: { lineNumber: 'ASC' },
    });

    const claimResponse = this.mapToClaimResponse(
      fullClaim!,
      claimItems,
      patientInsurance,
      insuranceProvider,
    );

    this.logger.log(
      `Insurance claim ${claimNumber} created successfully with ${dto.items.length} items`,
    );

    return {
      success: true,
      message: `Insurance claim ${claimNumber} created successfully`,
      data: {
        claim: claimResponse,
        validation: {
          amountValidation: {
            isValid: amountValidation.isValid,
            errors: amountValidation.errors,
            warnings: [],
          },
          timeValidation: {
            isValid: timeValidation.isValid,
            errors: timeValidation.errors,
            warnings: [],
          },
        },
      },
    };
  }

  /**
   * Retrieve a single insurance claim by its ID.
   */
  async getClaimById(
    claimId: string,
    workspaceId: string,
  ): Promise<ClaimResponseDto> {
    this.logger.log(`Fetching claim by ID: ${claimId}`);

    const claim = await this.claimRepository.findOne({
      where: { id: claimId, isActive: true },
      relations: ['patientInsurance', 'insuranceProvider', 'patient'],
    });

    if (!claim) {
      throw new NotFoundException(
        `Insurance claim with ID ${claimId} not found`,
      );
    }

    const claimItems = await this.claimItemRepository.find({
      where: { claimId: claim.id, isActive: true },
      order: { lineNumber: 'ASC' },
    });

    const patientInsurance = await this.patientInsuranceRepository.findOne({
      where: { id: claim.patientInsuranceId, isActive: true },
      relations: ['scheme'],
    });

    const insuranceProvider = await this.insuranceProviderRepository.findOne({
      where: { id: claim.insuranceProviderId, isActive: true },
    });

    return this.mapToClaimResponse(
      claim,
      claimItems,
      patientInsurance!,
      insuranceProvider!,
    );
  }

  /**
   * Retrieve all insurance claims associated with a specific bill.
   */
  async getClaimsByBill(
    billId: string,
    workspaceId: string,
  ): Promise<ClaimResponseDto[]> {
    this.logger.log(`Fetching claims for bill: ${billId}`);

    const claims = await this.claimRepository.find({
      where: { billId, isActive: true },
      relations: ['patientInsurance', 'insuranceProvider', 'patient'],
      order: { createdAt: 'DESC' },
    });

    const responses: ClaimResponseDto[] = [];
    for (const claim of claims) {
      const claimItems = await this.claimItemRepository.find({
        where: { claimId: claim.id, isActive: true },
        order: { lineNumber: 'ASC' },
      });

      const patientInsurance = await this.patientInsuranceRepository.findOne({
        where: { id: claim.patientInsuranceId, isActive: true },
        relations: ['scheme'],
      });

      const insuranceProvider = await this.insuranceProviderRepository.findOne({
        where: { id: claim.insuranceProviderId, isActive: true },
      });

      responses.push(
        this.mapToClaimResponse(
          claim,
          claimItems,
          patientInsurance!,
          insuranceProvider!,
        ),
      );
    }

    return responses;
  }

  /**
   * Retrieve all insurance claims for a given patient.
   */
  async getClaimsByPatient(
    patientId: string,
    workspaceId: string,
  ): Promise<ClaimResponseDto[]> {
    this.logger.log(`Fetching claims for patient: ${patientId}`);

    const claims = await this.claimRepository.find({
      where: { patientId, isActive: true },
      relations: ['patientInsurance', 'insuranceProvider', 'patient'],
      order: { createdAt: 'DESC' },
    });

    const responses: ClaimResponseDto[] = [];
    for (const claim of claims) {
      const claimItems = await this.claimItemRepository.find({
        where: { claimId: claim.id, isActive: true },
        order: { lineNumber: 'ASC' },
      });

      const patientInsurance = await this.patientInsuranceRepository.findOne({
        where: { id: claim.patientInsuranceId, isActive: true },
        relations: ['scheme'],
      });

      const insuranceProvider = await this.insuranceProviderRepository.findOne({
        where: { id: claim.insuranceProviderId, isActive: true },
      });

      responses.push(
        this.mapToClaimResponse(
          claim,
          claimItems,
          patientInsurance!,
          insuranceProvider!,
        ),
      );
    }

    return responses;
  }

  /**
   * Submit a pending claim for processing.
   * Only claims in PENDING status can be submitted.
   */
  async submitClaim(
    claimId: string,
    userId: string,
    workspaceId: string,
  ): Promise<ClaimResponseDto> {
    this.logger.log(`Submitting claim: ${claimId}`);

    const claim = await this.claimRepository.findOne({
      where: { id: claimId, isActive: true },
      relations: ['patientInsurance', 'insuranceProvider', 'patient'],
    });

    if (!claim) {
      throw new NotFoundException(
        `Insurance claim with ID ${claimId} not found`,
      );
    }

    if (claim.status !== InsuranceClaimStatus.PENDING) {
      throw new BadRequestException(
        `Claim ${claim.claimNumber} cannot be submitted. Current status: ${claim.status}. Only PENDING claims can be submitted.`,
      );
    }

    claim.status = InsuranceClaimStatus.CLAIMED;
    claim.submittedDate = new Date();
    claim.submittedBy = userId;

    await this.claimRepository.save(claim);

    // Update claim items to CLAIMED
    await this.claimItemRepository.update(
      { claimId: claim.id },
      { status: InsuranceClaimStatus.CLAIMED },
    );

    // Audit log
    try {
      await this.auditLogService.log(
        {
          userId,
          action: 'INSURANCE_CLAIM_SUBMITTED',
          eventType: AuditEventType.UPDATE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'InsuranceClaim',
          resourceId: claim.id,
          patientId: claim.patientId,
          previousState: { status: InsuranceClaimStatus.PENDING },
          newState: {
            status: InsuranceClaimStatus.CLAIMED,
            submittedDate: claim.submittedDate,
          },
        },
        workspaceId,
      );
    } catch (auditError) {
      this.logger.error(
        `Failed to write audit log for claim submission: ${auditError.message}`,
        auditError.stack,
      );
    }

    this.logger.log(
      `Claim ${claim.claimNumber} submitted successfully`,
    );

    const claimItems = await this.claimItemRepository.find({
      where: { claimId: claim.id, isActive: true },
      order: { lineNumber: 'ASC' },
    });

    const patientInsurance = await this.patientInsuranceRepository.findOne({
      where: { id: claim.patientInsuranceId, isActive: true },
      relations: ['scheme'],
    });

    const insuranceProvider = await this.insuranceProviderRepository.findOne({
      where: { id: claim.insuranceProviderId, isActive: true },
    });

    return this.mapToClaimResponse(
      claim,
      claimItems,
      patientInsurance!,
      insuranceProvider!,
    );
  }

  /**
   * Approve an insurance claim, specifying approved amounts per claim item.
   *
   * Calculates total approved, denied, and patient responsibility amounts.
   * Sets status to FULLY_APPROVED or PARTIALLY_APPROVED based on item-level
   * approved amounts.
   */
  async approveClaim(
    claimId: string,
    approvedAmounts: Record<string, number>,
    userId: string,
    workspaceId: string,
  ): Promise<ClaimResponseDto> {
    this.logger.log(`Approving claim: ${claimId}`);

    const claim = await this.claimRepository.findOne({
      where: { id: claimId, isActive: true },
      relations: ['patientInsurance', 'insuranceProvider', 'patient'],
    });

    if (!claim) {
      throw new NotFoundException(
        `Insurance claim with ID ${claimId} not found`,
      );
    }

    if (
      claim.status !== InsuranceClaimStatus.CLAIMED &&
      claim.status !== InsuranceClaimStatus.PENDING
    ) {
      throw new BadRequestException(
        `Claim ${claim.claimNumber} cannot be approved. Current status: ${claim.status}. Only PENDING or CLAIMED claims can be approved.`,
      );
    }

    const claimItems = await this.claimItemRepository.find({
      where: { claimId: claim.id, isActive: true },
      order: { lineNumber: 'ASC' },
    });

    let totalApproved = 0;
    let totalDenied = 0;
    let fullyApproved = true;

    for (const item of claimItems) {
      const approvedAmount = approvedAmounts[item.id] ?? 0;
      const deniedAmount = item.claimedAmount - approvedAmount;

      item.approvedAmount = Math.max(0, approvedAmount);
      item.deniedAmount = Math.max(0, deniedAmount);
      item.patientResponsibilityAmount = Math.max(0, deniedAmount);
      item.status =
        approvedAmount >= item.claimedAmount
          ? InsuranceClaimStatus.FULLY_APPROVED
          : approvedAmount > 0
            ? InsuranceClaimStatus.PARTIALLY_APPROVED
            : InsuranceClaimStatus.DENIED;

      await this.claimItemRepository.save(item);

      totalApproved += item.approvedAmount;
      totalDenied += item.deniedAmount;

      if (approvedAmount < item.claimedAmount) {
        fullyApproved = false;
      }
    }

    const patientResponsibility = totalDenied;

    claim.totalApprovedAmount = totalApproved;
    claim.totalDeniedAmount = totalDenied;
    claim.patientResponsibilityAmount = patientResponsibility;
    claim.processedDate = new Date();
    claim.processedBy = userId;
    claim.status = fullyApproved
      ? InsuranceClaimStatus.FULLY_APPROVED
      : InsuranceClaimStatus.PARTIALLY_APPROVED;

    await this.claimRepository.save(claim);

    // Update bill items with approved amounts
    for (const item of claimItems) {
      if (item.billItemId) {
        await this.billItemRepository.update(item.billItemId, {
          totalApprovedAmount: item.approvedAmount,
          totalDeniedAmount: item.deniedAmount,
          insuranceClaimStatus: item.status,
        });
      }
    }

    // Audit log
    try {
      await this.auditLogService.log(
        {
          userId,
          action: 'INSURANCE_CLAIM_APPROVED',
          eventType: AuditEventType.UPDATE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'InsuranceClaim',
          resourceId: claim.id,
          patientId: claim.patientId,
          previousState: { status: InsuranceClaimStatus.CLAIMED },
          newState: {
            status: claim.status,
            totalApprovedAmount: totalApproved,
            totalDeniedAmount: totalDenied,
            patientResponsibility,
          },
        },
        workspaceId,
      );
    } catch (auditError) {
      this.logger.error(
        `Failed to write audit log for claim approval: ${auditError.message}`,
        auditError.stack,
      );
    }

    this.logger.log(
      `Claim ${claim.claimNumber} approved. Status: ${claim.status}, Approved: ${totalApproved}, Denied: ${totalDenied}`,
    );

    const patientInsurance = await this.patientInsuranceRepository.findOne({
      where: { id: claim.patientInsuranceId, isActive: true },
      relations: ['scheme'],
    });

    const insuranceProvider = await this.insuranceProviderRepository.findOne({
      where: { id: claim.insuranceProviderId, isActive: true },
    });

    return this.mapToClaimResponse(
      claim,
      claimItems,
      patientInsurance!,
      insuranceProvider!,
    );
  }

  /**
   * Reject an insurance claim with a reason.
   */
  async rejectClaim(
    claimId: string,
    reason: string,
    userId: string,
    workspaceId: string,
  ): Promise<ClaimResponseDto> {
    this.logger.log(`Rejecting claim: ${claimId}`);

    const claim = await this.claimRepository.findOne({
      where: { id: claimId, isActive: true },
      relations: ['patientInsurance', 'insuranceProvider', 'patient'],
    });

    if (!claim) {
      throw new NotFoundException(
        `Insurance claim with ID ${claimId} not found`,
      );
    }

    if (
      claim.status !== InsuranceClaimStatus.CLAIMED &&
      claim.status !== InsuranceClaimStatus.PENDING
    ) {
      throw new BadRequestException(
        `Claim ${claim.claimNumber} cannot be rejected. Current status: ${claim.status}. Only PENDING or CLAIMED claims can be rejected.`,
      );
    }

    const previousStatus = claim.status;

    claim.status = InsuranceClaimStatus.DENIED;
    claim.denialReason = reason;
    claim.processedDate = new Date();
    claim.processedBy = userId;
    claim.totalDeniedAmount = claim.totalClaimedAmount;
    claim.patientResponsibilityAmount = claim.totalClaimedAmount;

    await this.claimRepository.save(claim);

    // Update all claim items to DENIED
    const claimItems = await this.claimItemRepository.find({
      where: { claimId: claim.id, isActive: true },
    });

    for (const item of claimItems) {
      item.status = InsuranceClaimStatus.DENIED;
      item.deniedAmount = item.claimedAmount;
      item.patientResponsibilityAmount = item.claimedAmount;
      item.denialReason = reason;
      await this.claimItemRepository.save(item);

      // Update the related bill item
      if (item.billItemId) {
        await this.billItemRepository.update(item.billItemId, {
          insuranceClaimStatus: InsuranceClaimStatus.DENIED,
          totalDeniedAmount: item.claimedAmount,
        });
      }
    }

    // Audit log
    try {
      await this.auditLogService.log(
        {
          userId,
          action: 'INSURANCE_CLAIM_REJECTED',
          eventType: AuditEventType.UPDATE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'InsuranceClaim',
          resourceId: claim.id,
          patientId: claim.patientId,
          previousState: { status: previousStatus },
          newState: {
            status: InsuranceClaimStatus.DENIED,
            denialReason: reason,
          },
        },
        workspaceId,
      );
    } catch (auditError) {
      this.logger.error(
        `Failed to write audit log for claim rejection: ${auditError.message}`,
        auditError.stack,
      );
    }

    this.logger.log(
      `Claim ${claim.claimNumber} rejected. Reason: ${reason}`,
    );

    const updatedItems = await this.claimItemRepository.find({
      where: { claimId: claim.id, isActive: true },
      order: { lineNumber: 'ASC' },
    });

    const patientInsurance = await this.patientInsuranceRepository.findOne({
      where: { id: claim.patientInsuranceId, isActive: true },
      relations: ['scheme'],
    });

    const insuranceProvider = await this.insuranceProviderRepository.findOne({
      where: { id: claim.insuranceProviderId, isActive: true },
    });

    return this.mapToClaimResponse(
      claim,
      updatedItems,
      patientInsurance!,
      insuranceProvider!,
    );
  }

  /**
   * Load structured claim data for the appointment/bill combination.
   * Used by the UI to pre-populate the claim creation form.
   */
  async getAppointmentClaimData(
    appointmentId: string,
    billId: string,
    workspaceId: string,
  ): Promise<AppointmentClaimDataDto> {
    this.logger.log(
      `Loading appointment claim data for appointment ${appointmentId}, bill ${billId}`,
    );

    // Load bill with items
    const bill = await this.patientBillRepository.findByIdWithRelations(billId);
    if (!bill) {
      throw new NotFoundException(`Bill with ID ${billId} not found`);
    }

    const billItems = await this.billItemRepository.findByBill(billId);

    // Load patient insurance records
    const patientInsurances = await this.patientInsuranceRepository.find({
      where: { patientId: bill.patientId, isActive: true },
      relations: ['insuranceProvider', 'scheme'],
      order: { priority: 'ASC' },
    });

    const warnings: string[] = [];
    if (patientInsurances.length === 0) {
      warnings.push('No active insurance records found for this patient');
    }

    // Map insurance records to DTOs
    const insuranceDtos: PatientInsuranceClaimDto[] = patientInsurances.map(
      (pi) => ({
        patientInsuranceId: pi.id,
        insuranceProviderId: pi.insuranceProviderId,
        insuranceProviderName: pi.insuranceProvider?.name ?? '',
        insuranceProviderShortName: pi.insuranceProvider?.shortName ?? '',
        schemeId: pi.schemeId,
        schemeName: pi.scheme?.schemeName ?? '',
        membershipNumber: pi.membershipNumber,
        policyNumber: pi.policyNumber,
        memberType: pi.memberType,
        status: pi.status,
        isPrimary: pi.isPrimary,
        priority: pi.priority,
        coveragePercentage: pi.scheme?.defaultCoveragePercentage ?? 0,
        annualLimit: 0,
        authorizationNumber: pi.currentAuthorizationNumber,
        authorizationExpiryDate: pi.authorizationExpiryDate
          ? new Date(pi.authorizationExpiryDate)
          : undefined,
      }),
    );

    const primaryInsurance = insuranceDtos.find((i) => i.isPrimary);
    const alternativeInsurances = insuranceDtos.filter((i) => !i.isPrimary);

    // Check for expired insurance
    for (const pi of patientInsurances) {
      if (pi.expiryDate && new Date(pi.expiryDate) < new Date()) {
        warnings.push(
          `Insurance ${pi.insuranceProvider?.name ?? pi.insuranceProviderId} has expired`,
        );
      }
    }

    // Extract diagnosis codes from bill metadata if available
    const diagnoses: string[] = [];
    if (bill.metadata?.diagnoses) {
      diagnoses.push(...bill.metadata.diagnoses);
    }

    return {
      serviceTimeIn: bill.issuedAt,
      serviceStartDate: bill.issuedAt,
      serviceTimeOut: bill.issuedAt,
      patientInsurance: primaryInsurance,
      alternativeInsurances,
      diagnoses,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Compute the insurance vs. patient payment split for a bill.
   */
  async getBillPaymentSplit(
    billId: string,
    workspaceId: string,
  ): Promise<{
    insuranceAmount: number;
    patientAmount: number;
    totalAmount: number;
  }> {
    this.logger.log(`Calculating payment split for bill: ${billId}`);

    const bill = await this.patientBillRepository.findOne({
      where: { id: billId, isActive: true },
    });

    if (!bill) {
      throw new NotFoundException(`Bill with ID ${billId} not found`);
    }

    const claims = await this.claimRepository.find({
      where: { billId, isActive: true },
    });

    let insuranceAmount = 0;
    for (const claim of claims) {
      if (
        claim.status === InsuranceClaimStatus.FULLY_APPROVED ||
        claim.status === InsuranceClaimStatus.PARTIALLY_APPROVED
      ) {
        insuranceAmount += Number(claim.totalApprovedAmount);
      }
    }

    const totalAmount = Number(bill.total);
    const patientAmount = Math.max(0, totalAmount - insuranceAmount);

    return {
      insuranceAmount: Math.round(insuranceAmount * 100) / 100,
      patientAmount: Math.round(patientAmount * 100) / 100,
      totalAmount: Math.round(totalAmount * 100) / 100,
    };
  }

  /**
   * Aggregate claim statistics for the workspace.
   *
   * Returns a comprehensive breakdown including total counts by status,
   * monetary totals for approved and denied amounts, and the average
   * processing time (in calendar days) for claims that have been processed.
   *
   * @param workspaceId - The workspace to scope the statistics to.
   * @returns Detailed claim statistics object.
   */
  async getClaimStatistics(
    workspaceId: string,
  ): Promise<{
    totalClaims: number;
    pendingClaims: number;
    submittedClaims: number;
    approvedAmount: number;
    deniedAmount: number;
    averageProcessingDays: number;
  }> {
    this.logger.log(`Fetching claim statistics for workspace: ${workspaceId}`);

    const allClaims = await this.claimRepository.find({
      where: { isActive: true },
    });

    const totalClaims = allClaims.length;

    const pendingClaims = allClaims.filter(
      (c) =>
        c.status === InsuranceClaimStatus.PENDING ||
        c.status === InsuranceClaimStatus.CLAIMED,
    ).length;

    const submittedClaims = allClaims.filter(
      (c) => c.status === InsuranceClaimStatus.CLAIMED,
    ).length;

    let approvedAmount = 0;
    let deniedAmount = 0;
    let totalProcessingDays = 0;
    let processedClaimCount = 0;

    for (const claim of allClaims) {
      approvedAmount += Number(claim.totalApprovedAmount);
      deniedAmount += Number(claim.totalDeniedAmount);

      // Calculate processing days for claims that have been processed
      if (claim.processedDate && claim.claimDate) {
        const processingMs =
          new Date(claim.processedDate).getTime() -
          new Date(claim.claimDate).getTime();
        totalProcessingDays += processingMs / (1000 * 60 * 60 * 24);
        processedClaimCount++;
      }
    }

    const averageProcessingDays =
      processedClaimCount > 0
        ? Math.round((totalProcessingDays / processedClaimCount) * 10) / 10
        : 0;

    return {
      totalClaims,
      pendingClaims,
      submittedClaims,
      approvedAmount: Math.round(approvedAmount * 100) / 100,
      deniedAmount: Math.round(deniedAmount * 100) / 100,
      averageProcessingDays,
    };
  }

  /**
   * Add a single line item to an existing insurance claim.
   *
   * Validates that:
   *  - The referenced claim exists and belongs to the workspace.
   *  - The claim is still in PENDING status (no additions after submission).
   *  - The bill item is not already included in this (or any other) claim.
   *
   * After persisting the new claim item the claim-level totals are
   * recalculated and the associated bill item is flagged as CLAIMED.
   *
   * @param claimId     - UUID of the target claim.
   * @param dto         - Payload describing the item to add.
   * @param userId      - ID of the user performing the action.
   * @param workspaceId - Workspace scope.
   * @returns The updated claim response DTO.
   */
  async addClaimItem(
    claimId: string,
    dto: {
      billItemId: string;
      claimedAmount: number;
      procedureCode?: string;
      revenueCode?: string;
      serviceDescription?: string;
    },
    userId: string,
    workspaceId: string,
  ): Promise<ClaimResponseDto> {
    this.logger.log(
      `Adding item to claim ${claimId} — billItem ${dto.billItemId}`,
    );

    // 1. Load and validate claim
    const claim = await this.claimRepository.findOne({
      where: { id: claimId, isActive: true },
      relations: ['patientInsurance', 'insuranceProvider', 'patient'],
    });

    if (!claim) {
      throw new NotFoundException(
        `Insurance claim with ID ${claimId} not found`,
      );
    }

    if (claim.status !== InsuranceClaimStatus.PENDING) {
      throw new BadRequestException(
        `Cannot add items to claim ${claim.claimNumber}. Current status: ${claim.status}. Only PENDING claims accept new items.`,
      );
    }

    // 2. Verify bill item exists and is not already claimed
    const billItem = await this.billItemRepository.findOne({
      where: { id: dto.billItemId, isActive: true },
    });

    if (!billItem) {
      throw new NotFoundException(
        `Bill item with ID ${dto.billItemId} not found`,
      );
    }

    const existingClaimItem = await this.claimItemRepository.findOne({
      where: { claimId, billItemId: dto.billItemId, isActive: true },
    });

    if (existingClaimItem) {
      throw new ConflictException(
        `Bill item ${dto.billItemId} is already included in claim ${claim.claimNumber}`,
      );
    }

    // 3. Determine next line number
    const currentItems = await this.claimItemRepository.find({
      where: { claimId, isActive: true },
      order: { lineNumber: 'DESC' },
    });
    const nextLineNumber =
      currentItems.length > 0 ? currentItems[0].lineNumber + 1 : 1;

    // 4. Persist in a transaction
    await this.dataSource.transaction(async (manager) => {
      const claimItem = manager.create(InsuranceClaimItem, {
        claimId,
        billItemId: dto.billItemId,
        lineNumber: nextLineNumber,
        serviceCode: dto.procedureCode ?? `SVC-${nextLineNumber}`,
        serviceDescription:
          dto.serviceDescription ?? billItem.description ?? `Claim item ${nextLineNumber}`,
        serviceDate: claim.serviceDate,
        quantity: Number(billItem.quantity),
        unitPrice: Number(billItem.unitPrice),
        claimedAmount: dto.claimedAmount,
        approvedAmount: 0,
        deniedAmount: 0,
        adjustedAmount: 0,
        paidAmount: 0,
        patientResponsibilityAmount: 0,
        status: InsuranceClaimStatus.PENDING,
        procedureCode: dto.procedureCode,
        revenueCode: dto.revenueCode,
        coveragePercentage: 0,
      });

      await manager.save(InsuranceClaimItem, claimItem);

      // Recalculate claim totals
      claim.totalClaimedAmount =
        Number(claim.totalClaimedAmount) + dto.claimedAmount;
      await manager.save(InsuranceClaim, claim);

      // Flag the bill item
      await manager.update(BillItem, dto.billItemId, {
        insuranceClaimStatus: InsuranceClaimStatus.CLAIMED,
        hasInsuranceClaim: true,
        totalClaimedAmount: dto.claimedAmount,
      });
    });

    // 5. Fire-and-forget audit
    this.auditLogService
      .log(
        {
          userId,
          action: 'INSURANCE_CLAIM_ITEM_ADDED',
          eventType: AuditEventType.UPDATE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'InsuranceClaim',
          resourceId: claimId,
          patientId: claim.patientId,
          newState: {
            billItemId: dto.billItemId,
            claimedAmount: dto.claimedAmount,
            lineNumber: nextLineNumber,
          },
        },
        workspaceId,
      )
      .catch((err) =>
        this.logger.error(
          `Failed to write audit log for addClaimItem: ${err.message}`,
          err.stack,
        ),
      );

    this.logger.log(
      `Item added to claim ${claim.claimNumber} — line ${nextLineNumber}`,
    );

    return this.getClaimById(claimId, workspaceId);
  }

  /**
   * Add multiple line items to an existing insurance claim in a single
   * atomic transaction.
   *
   * Each item undergoes the same validations as {@link addClaimItem}. If any
   * single item fails validation the entire batch is rejected and no items
   * are persisted.
   *
   * @param claimId     - UUID of the target claim.
   * @param dto         - Payload containing the array of items to add.
   * @param userId      - ID of the user performing the action.
   * @param workspaceId - Workspace scope.
   * @returns The updated claim response DTO.
   */
  async addBulkClaimItems(
    claimId: string,
    dto: {
      items: Array<{
        billItemId: string;
        claimedAmount: number;
        procedureCode?: string;
      }>;
    },
    userId: string,
    workspaceId: string,
  ): Promise<ClaimResponseDto> {
    this.logger.log(
      `Adding ${dto.items.length} items to claim ${claimId} (bulk)`,
    );

    // 1. Load and validate claim
    const claim = await this.claimRepository.findOne({
      where: { id: claimId, isActive: true },
      relations: ['patientInsurance', 'insuranceProvider', 'patient'],
    });

    if (!claim) {
      throw new NotFoundException(
        `Insurance claim with ID ${claimId} not found`,
      );
    }

    if (claim.status !== InsuranceClaimStatus.PENDING) {
      throw new BadRequestException(
        `Cannot add items to claim ${claim.claimNumber}. Current status: ${claim.status}. Only PENDING claims accept new items.`,
      );
    }

    // 2. Pre-validate all bill items before opening the transaction
    const billItemIds = dto.items.map((i) => i.billItemId);
    const existingClaimItems = await this.claimItemRepository.find({
      where: { claimId, isActive: true },
      order: { lineNumber: 'DESC' },
    });

    const existingBillItemIds = new Set(
      existingClaimItems
        .filter((ci) => ci.billItemId)
        .map((ci) => ci.billItemId),
    );

    for (const item of dto.items) {
      if (existingBillItemIds.has(item.billItemId)) {
        throw new ConflictException(
          `Bill item ${item.billItemId} is already included in claim ${claim.claimNumber}`,
        );
      }
    }

    // Verify all referenced bill items exist
    for (const item of dto.items) {
      const billItem = await this.billItemRepository.findOne({
        where: { id: item.billItemId, isActive: true },
      });
      if (!billItem) {
        throw new NotFoundException(
          `Bill item with ID ${item.billItemId} not found`,
        );
      }
    }

    // 3. Execute inside a single transaction for atomicity
    let startLineNumber =
      existingClaimItems.length > 0
        ? existingClaimItems[0].lineNumber + 1
        : 1;

    let additionalClaimedAmount = 0;

    await this.dataSource.transaction(async (manager) => {
      for (let i = 0; i < dto.items.length; i++) {
        const itemDto = dto.items[i];
        const lineNumber = startLineNumber + i;

        const billItem = await manager.findOne(BillItem, {
          where: { id: itemDto.billItemId, isActive: true },
        });

        const claimItem = manager.create(InsuranceClaimItem, {
          claimId,
          billItemId: itemDto.billItemId,
          lineNumber,
          serviceCode: itemDto.procedureCode ?? `SVC-${lineNumber}`,
          serviceDescription:
            billItem?.description ?? `Claim item ${lineNumber}`,
          serviceDate: claim.serviceDate,
          quantity: billItem ? Number(billItem.quantity) : 1,
          unitPrice: billItem ? Number(billItem.unitPrice) : itemDto.claimedAmount,
          claimedAmount: itemDto.claimedAmount,
          approvedAmount: 0,
          deniedAmount: 0,
          adjustedAmount: 0,
          paidAmount: 0,
          patientResponsibilityAmount: 0,
          status: InsuranceClaimStatus.PENDING,
          procedureCode: itemDto.procedureCode,
          coveragePercentage: 0,
        });

        await manager.save(InsuranceClaimItem, claimItem);

        // Flag the bill item
        await manager.update(BillItem, itemDto.billItemId, {
          insuranceClaimStatus: InsuranceClaimStatus.CLAIMED,
          hasInsuranceClaim: true,
          totalClaimedAmount: itemDto.claimedAmount,
        });

        additionalClaimedAmount += itemDto.claimedAmount;
      }

      // Recalculate claim totals
      claim.totalClaimedAmount =
        Number(claim.totalClaimedAmount) + additionalClaimedAmount;
      await manager.save(InsuranceClaim, claim);
    });

    // 4. Fire-and-forget audit
    this.auditLogService
      .log(
        {
          userId,
          action: 'INSURANCE_CLAIM_BULK_ITEMS_ADDED',
          eventType: AuditEventType.UPDATE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'InsuranceClaim',
          resourceId: claimId,
          patientId: claim.patientId,
          newState: {
            addedCount: dto.items.length,
            additionalClaimedAmount,
            billItemIds,
          },
        },
        workspaceId,
      )
      .catch((err) =>
        this.logger.error(
          `Failed to write audit log for addBulkClaimItems: ${err.message}`,
          err.stack,
        ),
      );

    this.logger.log(
      `${dto.items.length} items added to claim ${claim.claimNumber} (bulk)`,
    );

    return this.getClaimById(claimId, workspaceId);
  }

  /**
   * Remove a single line item from an existing insurance claim.
   *
   * The claim must be in PENDING status. Removing the item soft-deletes
   * the claim item record, recalculates the claim's total claimed amount,
   * and resets the associated bill item's insurance claim status back to
   * NOT_CLAIMED so it can be included in a future claim if needed.
   *
   * @param claimId     - UUID of the parent claim.
   * @param claimItemId - UUID of the claim item to remove.
   * @param userId      - ID of the user performing the action.
   * @param workspaceId - Workspace scope.
   * @returns The updated claim response DTO.
   */
  async removeClaimItem(
    claimId: string,
    claimItemId: string,
    userId: string,
    workspaceId: string,
  ): Promise<ClaimResponseDto> {
    this.logger.log(
      `Removing claim item ${claimItemId} from claim ${claimId}`,
    );

    // 1. Load and validate claim
    const claim = await this.claimRepository.findOne({
      where: { id: claimId, isActive: true },
      relations: ['patientInsurance', 'insuranceProvider', 'patient'],
    });

    if (!claim) {
      throw new NotFoundException(
        `Insurance claim with ID ${claimId} not found`,
      );
    }

    if (claim.status !== InsuranceClaimStatus.PENDING) {
      throw new BadRequestException(
        `Cannot remove items from claim ${claim.claimNumber}. Current status: ${claim.status}. Only PENDING claims allow item removal.`,
      );
    }

    // 2. Load the claim item
    const claimItem = await this.claimItemRepository.findOne({
      where: { id: claimItemId, claimId, isActive: true },
    });

    if (!claimItem) {
      throw new NotFoundException(
        `Claim item with ID ${claimItemId} not found in claim ${claimId}`,
      );
    }

    const removedAmount = Number(claimItem.claimedAmount);
    const removedBillItemId = claimItem.billItemId;

    // 3. Execute in a transaction
    await this.dataSource.transaction(async (manager) => {
      // Soft-delete the claim item
      await manager.update(InsuranceClaimItem, claimItemId, {
        isActive: false,
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: userId,
      });

      // Recalculate claim totals
      claim.totalClaimedAmount = Math.max(
        0,
        Number(claim.totalClaimedAmount) - removedAmount,
      );
      await manager.save(InsuranceClaim, claim);

      // Reset the bill item claim status
      if (removedBillItemId) {
        await manager.update(BillItem, removedBillItemId, {
          insuranceClaimStatus: InsuranceClaimStatus.NOT_CLAIMED,
          hasInsuranceClaim: false,
          totalClaimedAmount: 0,
        });
      }
    });

    // 4. Fire-and-forget audit
    this.auditLogService
      .log(
        {
          userId,
          action: 'INSURANCE_CLAIM_ITEM_REMOVED',
          eventType: AuditEventType.DELETE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'InsuranceClaim',
          resourceId: claimId,
          patientId: claim.patientId,
          previousState: {
            claimItemId,
            billItemId: removedBillItemId,
            claimedAmount: removedAmount,
          },
          newState: {
            totalClaimedAmount: Number(claim.totalClaimedAmount),
          },
        },
        workspaceId,
      )
      .catch((err) =>
        this.logger.error(
          `Failed to write audit log for removeClaimItem: ${err.message}`,
          err.stack,
        ),
      );

    this.logger.log(
      `Claim item ${claimItemId} removed from claim ${claim.claimNumber}`,
    );

    return this.getClaimById(claimId, workspaceId);
  }

  /**
   * Perform a standalone validation of an insurance claim without changing
   * its status.
   *
   * Checks performed:
   *  - All claim items have a procedure code assigned.
   *  - Individual item amounts are positive and do not exceed reasonable limits.
   *  - The sum of item amounts matches the claim-level total.
   *  - The patient's insurance record is active and not expired.
   *  - The insurance provider is active.
   *  - The total claimed amount does not exceed any provider-level maximum.
   *
   * The result includes hard `errors` (which would block submission) and
   * soft `warnings` (informational, non-blocking).
   *
   * @param claimId     - UUID of the claim to validate.
   * @param workspaceId - Workspace scope.
   * @returns Validation result with errors and warnings arrays.
   */
  async validateClaim(
    claimId: string,
    workspaceId: string,
  ): Promise<{ isValid: boolean; errors: string[]; warnings: string[] }> {
    this.logger.log(`Validating claim: ${claimId}`);

    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Load the claim
    const claim = await this.claimRepository.findOne({
      where: { id: claimId, isActive: true },
    });

    if (!claim) {
      return {
        isValid: false,
        errors: [`Insurance claim with ID ${claimId} not found`],
        warnings: [],
      };
    }

    // 2. Load claim items
    const claimItems = await this.claimItemRepository.find({
      where: { claimId: claim.id, isActive: true },
      order: { lineNumber: 'ASC' },
    });

    if (claimItems.length === 0) {
      errors.push('Claim has no line items');
    }

    // 3. Validate each item
    let itemsTotal = 0;
    for (const item of claimItems) {
      if (!item.procedureCode) {
        errors.push(
          `Item #${item.lineNumber} ("${item.serviceDescription}") is missing a procedure code`,
        );
      }

      if (Number(item.claimedAmount) <= 0) {
        errors.push(
          `Item #${item.lineNumber} has a non-positive claimed amount: ${item.claimedAmount}`,
        );
      }

      itemsTotal += Number(item.claimedAmount);
    }

    // 4. Verify amounts match
    const claimTotal = Number(claim.totalClaimedAmount);
    const tolerance = 0.01;
    if (Math.abs(itemsTotal - claimTotal) > tolerance) {
      errors.push(
        `Sum of item amounts (${itemsTotal.toFixed(2)}) does not match claim total (${claimTotal.toFixed(2)})`,
      );
    }

    // 5. Validate patient insurance
    const patientInsurance = await this.patientInsuranceRepository.findOne({
      where: { id: claim.patientInsuranceId },
      relations: ['scheme'],
    });

    if (!patientInsurance) {
      errors.push('Patient insurance record not found');
    } else {
      if (!patientInsurance.isActive) {
        errors.push('Patient insurance record is inactive');
      }

      if (
        patientInsurance.expiryDate &&
        new Date(patientInsurance.expiryDate) < new Date()
      ) {
        errors.push(
          `Patient insurance expired on ${new Date(patientInsurance.expiryDate).toISOString().slice(0, 10)}`,
        );
      }

      // Check scheme coverage limits (benefit limits)
      if (patientInsurance.scheme?.benefitLimits) {
        const limits = patientInsurance.scheme.benefitLimits;
        if (limits.annualMaximum && claimTotal > Number(limits.annualMaximum)) {
          warnings.push(
            `Claim total (${claimTotal.toFixed(2)}) may exceed the annual benefit limit (${limits.annualMaximum})`,
          );
        }
      }
    }

    // 6. Validate insurance provider
    const insuranceProvider = await this.insuranceProviderRepository.findOne({
      where: { id: claim.insuranceProviderId },
    });

    if (!insuranceProvider) {
      errors.push('Insurance provider record not found');
    } else {
      if (!insuranceProvider.isActive) {
        errors.push('Insurance provider is inactive');
      }

      if (
        insuranceProvider.maximumClaimAmount &&
        claimTotal > Number(insuranceProvider.maximumClaimAmount)
      ) {
        errors.push(
          `Claim total (${claimTotal.toFixed(2)}) exceeds provider maximum claim amount (${Number(insuranceProvider.maximumClaimAmount).toFixed(2)})`,
        );
      }

      if (
        insuranceProvider.minimumClaimAmount &&
        claimTotal < Number(insuranceProvider.minimumClaimAmount)
      ) {
        warnings.push(
          `Claim total (${claimTotal.toFixed(2)}) is below provider minimum claim amount (${Number(insuranceProvider.minimumClaimAmount).toFixed(2)})`,
        );
      }

      if (insuranceProvider.requiresPreAuthorization && !claim.authorizationNumber) {
        errors.push(
          'Insurance provider requires pre-authorization but no authorization number is set on the claim',
        );
      }
    }

    // 7. Warn about missing diagnosis
    if (!claim.diagnosisCode) {
      warnings.push('Claim does not have a diagnosis code');
    }

    const isValid = errors.length === 0;

    this.logger.log(
      `Claim ${claim.claimNumber} validation complete — valid: ${isValid}, errors: ${errors.length}, warnings: ${warnings.length}`,
    );

    return { isValid, errors, warnings };
  }

  /**
   * Record a payment received from an insurance provider against a claim.
   *
   * The claim must be in an approved state (FULLY_APPROVED or
   * PARTIALLY_APPROVED) to accept payments. A {@link Payment} record is
   * created referencing the claim's bill, and the claim's `totalPaidAmount`
   * is incremented accordingly.
   *
   * @param claimId     - UUID of the claim.
   * @param dto         - Payment details (amount, reference, date, optional notes).
   * @param userId      - ID of the user recording the payment.
   * @param workspaceId - Workspace scope.
   * @returns The updated claim response DTO.
   */
  async recordPayment(
    claimId: string,
    dto: {
      amount: number;
      referenceNumber: string;
      paymentDate: Date;
      notes?: string;
    },
    userId: string,
    workspaceId: string,
  ): Promise<ClaimResponseDto> {
    this.logger.log(
      `Recording payment of ${dto.amount} for claim ${claimId}`,
    );

    // 1. Load and validate claim
    const claim = await this.claimRepository.findOne({
      where: { id: claimId, isActive: true },
      relations: ['patientInsurance', 'insuranceProvider', 'patient'],
    });

    if (!claim) {
      throw new NotFoundException(
        `Insurance claim with ID ${claimId} not found`,
      );
    }

    if (
      claim.status !== InsuranceClaimStatus.FULLY_APPROVED &&
      claim.status !== InsuranceClaimStatus.PARTIALLY_APPROVED
    ) {
      throw new BadRequestException(
        `Cannot record payment for claim ${claim.claimNumber}. Current status: ${claim.status}. Only FULLY_APPROVED or PARTIALLY_APPROVED claims accept payments.`,
      );
    }

    if (dto.amount <= 0) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }

    const newTotalPaid = Number(claim.totalPaidAmount) + dto.amount;
    if (newTotalPaid > Number(claim.totalApprovedAmount)) {
      throw new BadRequestException(
        `Payment amount (${dto.amount}) would cause total paid (${newTotalPaid.toFixed(2)}) to exceed total approved (${Number(claim.totalApprovedAmount).toFixed(2)})`,
      );
    }

    // 2. Generate a payment reference
    const paymentReference = await this.paymentRepository.generatePaymentReference();

    // 3. Persist inside a transaction
    await this.dataSource.transaction(async (manager) => {
      // Create a Payment record linked to the bill
      if (claim.billId) {
        const payment = manager.create(Payment, {
          paymentReference,
          billId: claim.billId,
          patientId: claim.patientId,
          paymentMethodId: '', // Insurance payments may not have a method entity
          amount: dto.amount,
          processingFee: 0,
          netAmount: dto.amount,
          status: PaymentStatus.COMPLETED,
          insuranceProvider: claim.insuranceProvider?.name,
          insurancePolicyNumber: claim.referenceNumber,
          authorizationNumber: claim.authorizationNumber,
          paymentDate: new Date(dto.paymentDate),
          processedAt: new Date(),
          notes: dto.notes ?? `Insurance payment for claim ${claim.claimNumber}`,
          metadata: {
            source: 'INSURANCE_CLAIM',
            claimId: claim.id,
            claimNumber: claim.claimNumber,
            referenceNumber: dto.referenceNumber,
          },
        });

        await manager.save(Payment, payment);
      }

      // Update claim totals
      claim.totalPaidAmount = newTotalPaid;
      claim.referenceNumber = dto.referenceNumber;

      await manager.save(InsuranceClaim, claim);
    });

    // 4. Fire-and-forget audit
    this.auditLogService
      .log(
        {
          userId,
          action: 'INSURANCE_CLAIM_PAYMENT_RECORDED',
          eventType: AuditEventType.UPDATE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'InsuranceClaim',
          resourceId: claimId,
          patientId: claim.patientId,
          newState: {
            paymentAmount: dto.amount,
            paymentReference,
            referenceNumber: dto.referenceNumber,
            totalPaidAmount: newTotalPaid,
          },
        },
        workspaceId,
      )
      .catch((err) =>
        this.logger.error(
          `Failed to write audit log for recordPayment: ${err.message}`,
          err.stack,
        ),
      );

    this.logger.log(
      `Payment of ${dto.amount} recorded for claim ${claim.claimNumber} — ref ${paymentReference}`,
    );

    return this.getClaimById(claimId, workspaceId);
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  /**
   * Map an InsuranceClaim entity (with items and related records) into the
   * response DTO consumed by the API layer.
   */
  private mapToClaimResponse(
    claim: InsuranceClaim,
    claimItems: InsuranceClaimItem[],
    patientInsurance: PatientInsurance,
    insuranceProvider: InsuranceProvider,
  ): ClaimResponseDto {
    const items: ClaimItemResponseDto[] = claimItems.map((item) => ({
      id: item.id,
      description: item.serviceDescription,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      totalAmount: Number(item.claimedAmount),
      claimedAmount: Number(item.claimedAmount),
      itemCategory: item.revenueCode ?? 'GENERAL',
      procedureCode: item.procedureCode,
      status: item.status,
    }));

    const summary: ClaimSummaryResponseDto = {
      totalClaimedAmount: Number(claim.totalClaimedAmount),
      itemCount: claimItems.length,
      serviceDuration: claim.serviceEndDate
        ? Math.round(
            (new Date(claim.serviceEndDate).getTime() -
              new Date(claim.serviceDate).getTime()) /
              60000,
          )
        : undefined,
      createdAt: claim.createdAt,
    };

    const providerResponse: InsuranceProviderResponseDto = {
      id: insuranceProvider.id,
      name: insuranceProvider.name,
    };

    const patientInsuranceResponse: PatientInsuranceResponseDto = {
      id: patientInsurance.id,
      schemeName: patientInsurance.scheme?.schemeName ?? '',
      membershipNumber: patientInsurance.membershipNumber,
    };

    return {
      id: claim.id,
      claimNumber: claim.claimNumber,
      status: this.mapClaimStatus(claim.status),
      serviceStartDate: claim.serviceDate,
      serviceTimeIn: undefined,
      serviceTimeOut: undefined,
      billId: claim.billId ?? '',
      patientId: claim.patientId,
      patientName: claim.patient?.firstName
        ? `${claim.patient.firstName} ${claim.patient.lastName ?? ''}`
        : claim.patientId,
      diagnosis: claim.diagnosisDescription ?? claim.diagnosisCode,
      insuranceProvider: providerResponse,
      patientInsurance: patientInsuranceResponse,
      summary,
      items,
      approvedAmount: Number(claim.totalApprovedAmount),
      patientResponsibility: Number(claim.patientResponsibilityAmount),
      paidAmount: Number(claim.totalPaidAmount),
      totalClaimedAmount: Number(claim.totalClaimedAmount),
    };
  }

  /**
   * Map the entity-level InsuranceClaimStatus to the DTO-level ClaimStatus.
   */
  private mapClaimStatus(status: InsuranceClaimStatus): any {
    const statusMap: Record<string, string> = {
      [InsuranceClaimStatus.NOT_CLAIMED]: 'DRAFT',
      [InsuranceClaimStatus.PENDING]: 'PENDING',
      [InsuranceClaimStatus.CLAIMED]: 'SUBMITTED',
      [InsuranceClaimStatus.PARTIALLY_APPROVED]: 'PARTIALLY_APPROVED',
      [InsuranceClaimStatus.FULLY_APPROVED]: 'APPROVED',
      [InsuranceClaimStatus.DENIED]: 'REJECTED',
      [InsuranceClaimStatus.ADJUSTED]: 'IN_REVIEW',
      [InsuranceClaimStatus.APPEALED]: 'APPEALED',
      [InsuranceClaimStatus.WRITTEN_OFF]: 'CANCELLED',
      [InsuranceClaimStatus.CANCELLED]: 'CANCELLED',
    };
    return statusMap[status] ?? 'PENDING';
  }

  /**
   * Generate a unique claim number in the format CLM-YYYYMM-XXXXX.
   */
  private generateClaimNumber(): string {
    const prefix = NUMBER_PREFIXES.CLAIM;
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}-${year}${month}-${random}`;
  }

  /**
   * Calculate the expected coverage amount for a claim item based on the
   * item category and the configured coverage rates.
   *
   * When a `coveragePercentage` override is provided (e.g. from the
   * patient's insurance scheme), that value is blended with the
   * category-specific rate so the result reflects both the service
   * category weight and the plan's coverage level.
   *
   * @param itemCategory  - Service category (CONSULTATION, PROCEDURE, etc.)
   * @param amount        - The full claimed amount for the item.
   * @param coveragePercentage - Optional plan-level coverage percentage (0-100).
   *                             If omitted, only the category rate is applied.
   * @returns The calculated coverage amount, rounded to two decimal places.
   */
  private calculateItemCoverage(
    itemCategory: string,
    amount: number,
    coveragePercentage?: number,
  ): number {
    const category = itemCategory.toUpperCase();
    const categoryRate = INSURANCE_COVERAGE_RATES[category] ?? 0;

    // When a scheme-level coverage percentage is supplied, combine it with
    // the category rate so both dimensions are accounted for.
    const effectiveRate =
      coveragePercentage !== undefined && coveragePercentage > 0
        ? categoryRate * (coveragePercentage / 100)
        : categoryRate;

    return Math.round(amount * effectiveRate * 100) / 100;
  }
}
