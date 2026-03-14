export class TaxResponseDto {
  id: string;
  name: string;
  description?: string;
  taxType: string;
  rate: number;
  isCompound: boolean;
  applicableServices?: any;
  applicableDepartments?: any;
  effectiveFrom?: Date;
  effectiveUntil?: Date;
  isActive: boolean;
  metadata?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}
