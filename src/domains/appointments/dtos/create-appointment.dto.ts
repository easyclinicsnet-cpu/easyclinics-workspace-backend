import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
  IsBoolean,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppointmentType, PaymentMethodType, AppointmentStatus } from '../../../common/enums';

/**
 * DTO for creating a new appointment
 * Includes insurance validation when paymentMethod = INSURANCE
 */
export class CreateAppointmentDto {
  @ApiProperty({
    description: 'Patient ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsNotEmpty()
  patientId!: string;

  @ApiPropertyOptional({
    description: 'Consultation ID if linking to existing consultation',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsOptional()
  consultationId?: string;

  @ApiProperty({
    description: 'Appointment date (YYYY-MM-DD)',
    example: '2024-01-15',
  })
  @IsDateString()
  @IsNotEmpty()
  date!: string;

  @ApiProperty({
    description: 'Appointment type',
    enum: AppointmentType,
    example: AppointmentType.INITIAL,
  })
  @IsEnum(AppointmentType)
  @IsNotEmpty()
  type!: AppointmentType;

  @ApiPropertyOptional({
    description: 'Appointment status',
    enum: AppointmentStatus,
    example: AppointmentStatus.SCHEDULED,
  })
  @IsEnum(AppointmentStatus)
  @IsOptional()
  status?: AppointmentStatus;

  @ApiProperty({
    description: 'Appointment time (HH:mm format)',
    example: '14:30',
  })
  @IsString()
  @IsNotEmpty()
  time!: string;

  @ApiProperty({
    description: 'Payment method',
    enum: PaymentMethodType,
    example: PaymentMethodType.CASH,
  })
  @IsEnum(PaymentMethodType)
  @IsNotEmpty()
  paymentMethod!: PaymentMethodType;

  @ApiPropertyOptional({
    description: 'Transcription ID for audio/video consultation',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  @IsOptional()
  transcriptionId?: string;

  // ===== INSURANCE FIELDS (required when paymentMethod = INSURANCE) =====

  @ApiPropertyOptional({
    description: 'Insurance provider ID (required for INSURANCE payment method)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ValidateIf((o) => o.paymentMethod === PaymentMethodType.INSURANCE)
  @IsNotEmpty({ message: 'Insurance provider is required for INSURANCE payment method' })
  @IsUUID()
  insuranceProviderId?: string;

  @ApiPropertyOptional({
    description: 'Insurance scheme ID (required for INSURANCE payment method)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ValidateIf((o) => o.paymentMethod === PaymentMethodType.INSURANCE)
  @IsNotEmpty({ message: 'Insurance scheme is required for INSURANCE payment method' })
  @IsUUID()
  schemeId?: string;

  @ApiPropertyOptional({
    description: 'Membership number (required for INSURANCE payment method)',
    example: 'MED123456',
  })
  @ValidateIf((o) => o.paymentMethod === PaymentMethodType.INSURANCE)
  @IsNotEmpty({ message: 'Membership number is required for INSURANCE payment method' })
  @IsString()
  membershipNumber?: string;

  @ApiPropertyOptional({
    description: 'Member type (required for INSURANCE payment method)',
    enum: ['PRINCIPAL', 'DEPENDENT'],
    example: 'PRINCIPAL',
  })
  @ValidateIf((o) => o.paymentMethod === PaymentMethodType.INSURANCE)
  @IsNotEmpty({ message: 'Member type is required for INSURANCE payment method' })
  @IsEnum(['PRINCIPAL', 'DEPENDENT'], { message: 'Member type must be PRINCIPAL or DEPENDENT' })
  memberType?: 'PRINCIPAL' | 'DEPENDENT';

  @ApiPropertyOptional({
    description: 'Flag to update patient insurance record with these details',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  updatePatientInsurance?: boolean;
}
