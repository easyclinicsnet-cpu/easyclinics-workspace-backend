import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsUUID,
  IsEnum,
  IsBoolean,
  IsOptional,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ConsultationStatus, CollaborationRole } from '../../../common/enums';

/**
 * Collaborator DTO for consultation creation
 */
export class CollaboratorDto {
  @ApiProperty({
    description: 'User ID of the collaborator',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  userId!: string;

  @ApiProperty({
    description: 'Role of the collaborator',
    enum: CollaborationRole,
    example: CollaborationRole.DOCTOR,
  })
  @IsEnum(CollaborationRole)
  role!: CollaborationRole;
}

/**
 * Create Consultation DTO
 * Data transfer object for creating a new consultation
 */
export class CreateConsultationDto {
  @ApiProperty({
    description: 'Patient ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  patientId!: string;

  @ApiProperty({
    description: 'Appointment ID (must be unique)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  appointmentId!: string;

  @ApiPropertyOptional({
    description:
      'Doctor ID — ignored by the server. The authenticated user from the JWT token ' +
      'is always used as the consultation owner. Kept optional for backward compatibility.',
    example: '550e8400-e29b-41d4-a716-446655440000',
    deprecated: true,
  })
  @IsUUID()
  @IsOptional()
  doctorId?: string;

  @ApiPropertyOptional({
    description: 'Initial consultation status',
    enum: ConsultationStatus,
    default: ConsultationStatus.DRAFT,
  })
  @IsEnum(ConsultationStatus)
  @IsOptional()
  status?: ConsultationStatus;

  @ApiPropertyOptional({
    description: 'Allow other practitioners to request joining this consultation',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  isOpenForJoining?: boolean;

  @ApiPropertyOptional({
    description: 'Require manual approval for join requests',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  requiresJoinApproval?: boolean;

  @ApiPropertyOptional({
    description: 'Initial collaborators to add',
    type: [CollaboratorDto],
    isArray: true,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CollaboratorDto)
  @IsOptional()
  collaborators?: CollaboratorDto[];
}
