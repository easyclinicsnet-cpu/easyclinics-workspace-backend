import {
  IsString, IsOptional, IsEmail, IsBoolean, MaxLength, IsObject,
} from 'class-validator';

export class UpdateSupplierDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  contactPerson?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  taxIdentificationNumber?: string;

  @IsObject()
  @IsOptional()
  paymentTerms?: Record<string, any>;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
