import {
  IsString,
  IsOptional,
  IsNumber,
  IsUUID,
  IsDateString,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { InsuranceClaimStatus } from '../../../../common/enums';

export class ServiceTimeDto {
  @IsString()
  @IsOptional()
  timeIn?: string;

  @IsString()
  @IsOptional()
  timeOut?: string;
}

export class CreateClaimItemDto {
  @IsUUID()
  billItemId: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  quantity: number;

  @IsNumber()
  unitPrice: number;

  @IsNumber()
  totalAmount: number;

  @IsNumber()
  claimedAmount: number;

  @IsString()
  @IsOptional()
  itemCategory?: string;

  @IsString()
  @IsOptional()
  procedureCode?: string;

  @IsString()
  @IsOptional()
  diagnosisCode?: string;

  @IsString()
  @IsOptional()
  revenueCode?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}

export class CreateClaimWithItemsDto {
  @IsUUID()
  billId: string;

  @IsUUID()
  patientInsuranceId: string;

  @IsUUID()
  insuranceProviderId: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'At least one claim item is required' })
  @ValidateNested({ each: true })
  @Type(() => CreateClaimItemDto)
  items: CreateClaimItemDto[];

  @IsDateString()
  serviceStartDate: string;

  @ValidateNested()
  @Type(() => ServiceTimeDto)
  @IsOptional()
  serviceTime?: ServiceTimeDto;

  @IsNumber()
  @IsNotEmpty()
  totalClaimedAmount: number;

  @IsString()
  @IsOptional()
  diagnosisCode?: string;

  @IsString()
  @IsOptional()
  diagnosisDescription?: string;

  @IsArray()
  @IsOptional()
  procedureCodes?: string[];

  @IsString()
  @IsOptional()
  preAuthorizationNumber?: string;

  @IsDateString()
  @IsOptional()
  preAuthorizationDate?: string;

  @IsString()
  @IsOptional()
  clinicalNotes?: string;

  @IsArray()
  @IsOptional()
  attachments?: string[];

  @IsString()
  @IsOptional()
  preparedBy?: string;

  @IsString()
  @IsOptional()
  reviewedBy?: string;

  @IsOptional()
  metadata?: Record<string, any>;

  validateAmounts(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    this.items.forEach((item, index) => {
      if (item.claimedAmount > item.totalAmount) {
        errors.push(
          `Item ${index + 1} (${item.billItemId}): Claimed amount (${item.claimedAmount}) exceeds total amount (${item.totalAmount})`,
        );
      }
      if (item.claimedAmount <= 0) {
        errors.push(
          `Item ${index + 1} (${item.billItemId}): Claimed amount must be greater than zero`,
        );
      }
    });
    return { isValid: errors.length === 0, errors };
  }

  validateServiceTime(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (this.serviceTime) {
      const { timeIn, timeOut } = this.serviceTime;
      if (timeOut && !timeIn) {
        errors.push('Service time in is required when time out is provided');
      }
      if (timeIn && timeOut && timeIn >= timeOut) {
        errors.push('Service time in must be before service time out');
      }
    }
    return { isValid: errors.length === 0, errors };
  }

  getTotalClaimedAmount(): number {
    return this.items.reduce((sum, item) => sum + item.claimedAmount, 0);
  }

  getTotalBillAmount(): number {
    return this.items.reduce((sum, item) => sum + item.totalAmount, 0);
  }

  getSummary(): {
    itemCount: number;
    totalBillAmount: number;
    totalClaimedAmount: number;
    insurancePercentage: number;
  } {
    const totalBillAmount = this.getTotalBillAmount();
    const totalClaimedAmount = this.getTotalClaimedAmount();
    const insurancePercentage =
      totalBillAmount > 0
        ? Math.round((totalClaimedAmount / totalBillAmount) * 100)
        : 0;
    return {
      itemCount: this.items.length,
      totalBillAmount: Math.round(totalBillAmount * 100) / 100,
      totalClaimedAmount: Math.round(totalClaimedAmount * 100) / 100,
      insurancePercentage,
    };
  }
}

export enum ClaimStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  SUBMITTED = 'SUBMITTED',
  IN_REVIEW = 'IN_REVIEW',
  APPROVED = 'APPROVED',
  PARTIALLY_APPROVED = 'PARTIALLY_APPROVED',
  REJECTED = 'REJECTED',
  PAID = 'PAID',
  APPEALED = 'APPEALED',
  CANCELLED = 'CANCELLED',
}
