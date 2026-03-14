export class PricingStrategyResponseDto {
  id: string;
  name: string;
  description?: string;
  strategyType: string;
  serviceType?: string;
  department?: string;
  basePrice?: number;
  markupPercentage?: number;
  discountPercentage?: number;
  minPrice?: number;
  maxPrice?: number;
  priority: number;
  validFrom?: Date;
  validUntil?: Date;
  conditions?: any;
  pricingRules?: any;
  isActive: boolean;
  metadata?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}
