import { InsuranceClaimStatus } from '../../../../common/enums';

export class BillItemResponseDto {
  id: string;
  billId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  department?: string;
  medicationItemId?: string;
  consumableItemId?: string;
  batchId?: string;
  actualUnitCost?: number;
  hasInsuranceClaim?: boolean;
  insuranceClaimStatus?: InsuranceClaimStatus;
  totalClaimedAmount?: number;
  totalApprovedAmount?: number;
  totalDeniedAmount?: number;
  metadata?: Record<string, any>;
  createdAt?: Date;
}

export class BillItemSummaryDto {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  department?: string;
}
