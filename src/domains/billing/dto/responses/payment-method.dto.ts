import { PaymentMethodType } from '../../../../common/enums';

export class PaymentMethodResponseDto {
  id: string;
  type: PaymentMethodType;
  name: string;
  description?: string;
  processingFeePercentage?: number;
  minAmount?: number;
  maxAmount?: number;
  sortOrder: number;
  icon?: string;
  color?: string;
  isActive: boolean;
  configuration?: any;
  metadata?: Record<string, any>;
  createdAt?: Date;
}
