import { Supplier } from '../../entities/supplier.entity';

export class SupplierResponseDto {
  id: string;
  workspaceId: string;
  code: string;
  name: string;
  description?: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  taxIdentificationNumber?: string;
  paymentTerms?: Record<string, any>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;

  static fromEntity(entity: Supplier): SupplierResponseDto {
    const dto = new SupplierResponseDto();
    dto.id = entity.id;
    dto.workspaceId = entity.workspaceId;
    dto.code = entity.code;
    dto.name = entity.name;
    dto.description = entity.description;
    dto.contactPerson = entity.contactPerson;
    dto.email = entity.email;
    dto.phone = entity.phone;
    dto.address = entity.address;
    dto.taxIdentificationNumber = entity.taxIdentificationNumber;
    dto.paymentTerms = entity.paymentTerms;
    dto.isActive = entity.isActive;
    dto.createdAt = entity.createdAt?.toISOString();
    dto.updatedAt = entity.updatedAt?.toISOString();
    return dto;
  }
}
