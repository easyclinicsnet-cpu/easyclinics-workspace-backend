import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum, IsUUID, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ProviderStatus } from '../../entities/insurance-provider.entity';
import { SchemeType } from '../../entities/insurance-scheme.entity';

export class QueryInsuranceSchemeDto {
  @ApiPropertyOptional({ description: 'Search on schemeName or schemeCode' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by parent insurance provider UUID', format: 'uuid' })
  @IsUUID()
  @IsOptional()
  providerId?: string;

  @ApiPropertyOptional({ enum: SchemeType, description: 'Filter by scheme type' })
  @IsEnum(SchemeType)
  @IsOptional()
  schemeType?: SchemeType;

  @ApiPropertyOptional({ enum: ProviderStatus, description: 'Filter by status' })
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
