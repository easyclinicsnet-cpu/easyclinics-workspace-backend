import { PartialType } from '@nestjs/mapped-types';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsDateString, IsUUID } from 'class-validator';
import { CreateInsuranceContractDto } from './create-insurance-contract.dto';
import { ProviderStatus } from '../../entities/insurance-provider.entity';

export class UpdateInsuranceContractDto extends PartialType(CreateInsuranceContractDto) {
  @ApiPropertyOptional({ enum: ProviderStatus, description: 'Contract status' })
  @IsEnum(ProviderStatus)
  @IsOptional()
  status?: ProviderStatus;

  @ApiPropertyOptional({ description: 'UUID of the approver', format: 'uuid' })
  @IsUUID()
  @IsOptional()
  approvedBy?: string;

  @ApiPropertyOptional({ example: '2024-11-01', description: 'Date the contract was approved (ISO 8601)' })
  @IsDateString()
  @IsOptional()
  approvedDate?: string;
}
