import {
  IsString, IsNotEmpty, IsOptional, IsUUID, IsEmail, MaxLength, IsObject,
} from 'class-validator';

export class CreateSupplierDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  contactPerson: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsString()
  @IsOptional()
  taxIdentificationNumber?: string;

  @IsObject()
  @IsOptional()
  paymentTerms?: Record<string, any>;
}
