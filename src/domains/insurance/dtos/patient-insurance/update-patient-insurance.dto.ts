import { PartialType } from '@nestjs/mapped-types';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { CreatePatientInsuranceDto } from './create-patient-insurance.dto';
import { ProviderStatus } from '../../entities/insurance-provider.entity';

export class UpdatePatientInsuranceDto extends PartialType(CreatePatientInsuranceDto) {
  @ApiPropertyOptional({ enum: ProviderStatus, description: 'Coverage status' })
  @IsEnum(ProviderStatus)
  @IsOptional()
  status?: ProviderStatus;
}
