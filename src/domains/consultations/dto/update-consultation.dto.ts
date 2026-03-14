import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsEnum, IsBoolean, IsOptional } from 'class-validator';
import { ConsultationStatus } from '../../../common/enums';

/**
 * DTO for updating a consultation
 */
export class UpdateConsultationDto {
  @ApiPropertyOptional({
    description: 'Consultation status',
    enum: ConsultationStatus,
  })
  @IsEnum(ConsultationStatus)
  @IsOptional()
  status?: ConsultationStatus;

  @ApiPropertyOptional({
    description: 'Doctor ID (consultation owner)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  @IsOptional()
  doctorId?: string;

  @ApiPropertyOptional({
    description: 'Allow other practitioners to request joining',
  })
  @IsBoolean()
  @IsOptional()
  isOpenForJoining?: boolean;

  @ApiPropertyOptional({
    description: 'Require manual approval for join requests',
  })
  @IsBoolean()
  @IsOptional()
  requiresJoinApproval?: boolean;
}
