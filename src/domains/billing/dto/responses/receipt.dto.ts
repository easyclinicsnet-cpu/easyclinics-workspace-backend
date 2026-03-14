export class ReceiptResponseDto {
  id: string;
  receiptNumber: string;
  paymentId: string;
  patientId: string;
  amount: number;
  paymentMethod: string;
  issuedAt: Date;
  issuedBy?: string;
  notes?: string;
  metadata?: Record<string, any>;
  createdAt?: Date;
}
