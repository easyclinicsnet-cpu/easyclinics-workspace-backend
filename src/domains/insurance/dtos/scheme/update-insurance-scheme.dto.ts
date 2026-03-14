import { PartialType } from '@nestjs/mapped-types';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateInsuranceSchemeDto } from './create-insurance-scheme.dto';
import { ProviderStatus } from '../../entities/insurance-provider.entity';

export class UpdateInsuranceSchemeDto extends PartialType(CreateInsuranceSchemeDto) {
  @ApiPropertyOptional({ enum: ProviderStatus, description: 'Scheme activation status' })
  @IsEnum(ProviderStatus)
  @IsOptional()
  status?: ProviderStatus;
}
