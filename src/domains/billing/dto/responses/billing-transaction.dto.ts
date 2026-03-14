export class BillingTransactionResponseDto {
  id: string;
  transactionReference: string;
  transactionType: string;
  billId?: string;
  paymentId?: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  status: string;
  transactionDate: Date;
  processedBy?: string;
  description?: string;
  notes?: string;
  metadata?: Record<string, any>;
  createdAt?: Date;
}
