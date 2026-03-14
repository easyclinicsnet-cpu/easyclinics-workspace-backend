import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ProviderStatus } from '../../entities/insurance-provider.entity';

export class QueryInsuranceProviderDto {
  @ApiPropertyOptional({ description: 'Full-text search on name, shortName, providerCode' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ enum: ProviderStatus, description: 'Filter by provider status' })
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
