import { PaymentStatus, PaymentMethodType } from '../../../../common/enums';

export class PaymentResponseDto {
  id: string;
  paymentReference: string;
  billId: string;
  patientId: string;
  paymentMethodId: string;
  paymentMethodType?: PaymentMethodType;
  amount: number;
  processingFee: number;
  netAmount: number;
  status: PaymentStatus;
  transactionId?: string;
  paymentDate: Date;
  processedAt?: Date;
  refundedAt?: Date;
  failedAt?: Date;
  notes?: string;
  failureReason?: string;
  metadata?: Record<string, any>;
  paymentMethod?: {
    id: string;
    name: string;
    type: PaymentMethodType;
  };
  createdAt?: Date;
}

export class PaymentBreakdownDto {
  subtotal: number;
  processingFee: number;
  netAmount: number;
  paymentMethod: string;
}
