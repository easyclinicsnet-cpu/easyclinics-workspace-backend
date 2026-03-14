export class DiscountResponseDto {
  id: string;
  name: string;
  description?: string;
  discountType: string;
  value: number;
  isPercentage: boolean;
  maxDiscountAmount?: number;
  minPurchaseAmount?: number;
  validFrom?: Date;
  validUntil?: Date;
  applicableServices?: any;
  applicableDepartments?: any;
  usageLimit?: number;
  usageCount: number;
  isActive: boolean;
  metadata?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}
