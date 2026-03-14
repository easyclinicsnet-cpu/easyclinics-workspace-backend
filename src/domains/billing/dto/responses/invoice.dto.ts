import { BillStatus } from '../../../../common/enums';

export class InvoiceResponseDto {
  id: string;
  invoiceNumber: string;
  billId: string;
  patientId: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  status: BillStatus;
  issuedAt: Date;
  dueDate?: Date;
  paidAt?: Date;
  notes?: string;
  terms?: string;
  metadata?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}
