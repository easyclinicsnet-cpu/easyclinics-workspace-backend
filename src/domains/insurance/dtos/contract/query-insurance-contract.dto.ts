import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum, IsUUID, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ProviderStatus } from '../../entities/insurance-provider.entity';
import { ContractType } from '../../entities/insurance-contract.entity';

export class QueryInsuranceContractDto {
  @ApiPropertyOptional({ description: 'Search on contractName or contractNumber' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by insurance provider UUID', format: 'uuid' })
  @IsUUID()
  @IsOptional()
  insuranceProviderId?: string;

  @ApiPropertyOptional({ description: 'Filter by scheme UUID', format: 'uuid' })
  @IsUUID()
  @IsOptional()
  schemeId?: string;

  @ApiPropertyOptional({ enum: ContractType, description: 'Filter by contract type' })
  @IsEnum(ContractType)
  @IsOptional()
  contractType?: ContractType;

  @ApiPropertyOptional({ enum: ProviderStatus, description: 'Filter by contract status' })
  @IsEnum(ProviderStatus)
  @IsOptional()
  status?: ProviderStatus;

  @ApiPropertyOptional({ default: 1, minimum: 1, description: 'Page number (1-based)' })
  @IsNumber()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, description: 'Records per page' })
  @IsNumber()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;
}
