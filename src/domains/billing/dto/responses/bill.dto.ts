import { BillStatus } from '../../../../common/enums';
import { BillItemResponseDto } from './bill-item.dto';
import { PaymentResponseDto } from './payment.dto';
import { DiscountResponseDto } from './discount.dto';
import { TaxResponseDto } from './tax.dto';
import { PaginatedResponseMetaDto } from '../common/pagination.dto';

export class BillResponseDto {
  id: string;
  billNumber: string;
  patientId: string;
  appointmentId: string;
  department?: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  status: BillStatus;
  issuedAt: Date;
  dueDate?: Date;
  notes?: string;
  metadata?: Record<string, any>;
  items: BillItemResponseDto[];
  payments: PaymentResponseDto[];
  appliedDiscount?: DiscountResponseDto;
  appliedTax?: TaxResponseDto;
  insuranceClaim?: any;
  createdAt?: Date;
  updatedAt?: Date;

  constructor(partial?: Partial<BillResponseDto>) {
    if (partial) {
      Object.assign(this, partial);
    }
  }
}

export class BillSummaryDto {
  id: string;
  billNumber: string;
  patientId: string;
  total: number;
  status: BillStatus;
  issuedAt: Date;
  dueDate?: Date;
  itemCount: number;
  totalPaid: number;
  balance: number;
}

export class PaginatedBillResponseDto {
  data: BillResponseDto[];
  meta: PaginatedResponseMetaDto;
}

export class BillAnalyticsDto {
  totalBills: number;
  totalRevenue: number;
  totalOutstanding: number;
  billsByStatus: Record<string, number>;
  revenueByDepartment: Record<string, number>;
  averageBillAmount: number;
  topItems: Array<{ description: string; count: number; totalAmount: number }>;
}
