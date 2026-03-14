import { PartialType } from '@nestjs/mapped-types';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateInsuranceProviderDto } from './create-insurance-provider.dto';
import { ProviderStatus } from '../../entities/insurance-provider.entity';

export class UpdateInsuranceProviderDto extends PartialType(CreateInsuranceProviderDto) {
  @ApiPropertyOptional({ enum: ProviderStatus, description: 'Provider activation status' })
  @IsEnum(ProviderStatus)
  @IsOptional()
  status?: ProviderStatus;
}
