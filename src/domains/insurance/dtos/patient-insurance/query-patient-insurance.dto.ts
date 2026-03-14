import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum, IsUUID, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ProviderStatus } from '../../entities/insurance-provider.entity';
import { MemberType } from '../../entities/patient-insurance.entity';

export class QueryPatientInsuranceDto {
  @ApiPropertyOptional({ description: 'Filter by patient UUID', format: 'uuid' })
  @IsUUID()
  @IsOptional()
  patientId?: string;

  @ApiPropertyOptional({ description: 'Filter by insurance provider UUID', format: 'uuid' })
  @IsUUID()
  @IsOptional()
  insuranceProviderId?: string;

  @ApiPropertyOptional({ description: 'Filter by scheme UUID', format: 'uuid' })
  @IsUUID()
  @IsOptional()
  schemeId?: string;

  @ApiPropertyOptional({ enum: MemberType, description: 'Filter by member type' })
  @IsEnum(MemberType)
  @IsOptional()
  memberType?: MemberType;

  @ApiPropertyOptional({ enum: ProviderStatus, description: 'Filter by coverage status' })
  @IsEnum(ProviderStatus)
  @IsOptional()
  status?: ProviderStatus;

  @ApiPropertyOptional({ description: 'Search by membership number or policy number' })
  @IsString()
  @IsOptional()
  search?: string;

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
