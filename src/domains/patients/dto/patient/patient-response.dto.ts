import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Patient } from '../../entities/patient.entity';
import { Exclude, Expose, Transform, Type } from 'class-transformer';
import { PatientInsuranceInfoDto } from './patient-insurance-info.dto';
import { Gender } from '../../constants/patient.constants';

/**
 * Patient Response DTO
 * Standard response format for single patient retrieval with computed fields
 *
 * Features:
 * - All decrypted patient data
 * - Computed fields: age, ageYears, ageMonths, fullName, formattedGender
 * - Insurance information (if exists)
 * - Excludes sensitive internal fields (deletedById, insuranceMigrated)
 * - Transforms dates to ISO strings
 * - Static fromEntity() factory method
 */

// Assuming AppointmentStatus enum exists
enum AppointmentStatus {
  SCHEDULED = 'SCHEDULED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  MISSED = 'MISSED',
  RESCHEDULED = 'RESCHEDULED',
}

@Exclude()
export class PatientResponseDto {
  // ===== BASIC IDENTIFIERS =====
  @ApiProperty({
    description: 'Patient unique identifier',
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
  })
  @Expose()
  id!: string;

  @ApiProperty({
    description: 'Workspace ID for multi-tenant isolation',
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
  })
  @Expose()
  workspaceId!: string;

  @ApiPropertyOptional({
    description: 'External system ID',
    example: 'EXT-12345',
  })
  @Expose()
  externalId?: string;

  // ===== DEMOGRAPHICS (DECRYPTED) =====
  @ApiProperty({
    description: 'Patient first name (decrypted, UPPERCASE)',
    example: 'JOHN',
  })
  @Expose()
  firstName!: string;

  @ApiProperty({
    description: 'Patient last name (decrypted, UPPERCASE)',
    example: 'DOE',
  })
  @Expose()
  lastName!: string;

  @ApiProperty({
    description: 'Computed field: Full name (firstName + lastName)',
    example: 'JOHN DOE',
  })
  @Expose()
  fullName!: string;

  @ApiProperty({
    description: 'Patient gender (decrypted)',
    enum: Gender,
    example: Gender.MALE,
  })
  @Expose()
  gender!: string;

  @ApiProperty({
    description: 'Formatted gender for display',
    example: 'Male',
  })
  @Expose()
  formattedGender!: string;

  @ApiProperty({
    description: 'Patient birth date (decrypted)',
    example: '1990-05-15',
    format: 'date',
  })
  @Expose()
  birthDate!: string;

  // ===== COMPUTED AGE FIELDS =====
  @ApiProperty({
    description: 'Computed field: Age as formatted string',
    example: '33 years',
  })
  @Expose()
  age!: string;

  @ApiProperty({
    description: 'Computed field: Age in years',
    example: 33,
    minimum: 0,
  })
  @Expose()
  ageYears!: number;

  @ApiProperty({
    description: 'Computed field: Age months component (for children under 2)',
    example: 5,
    minimum: 0,
    maximum: 11,
  })
  @Expose()
  ageMonths!: number;

  // ===== CONTACT INFORMATION (DECRYPTED) =====
  @ApiPropertyOptional({
    description: 'Patient phone number (decrypted)',
    example: '+27821234567',
  })
  @Expose()
  phoneNumber?: string;

  @ApiPropertyOptional({
    description: 'Patient email address (decrypted)',
    example: 'john.doe@example.com',
  })
  @Expose()
  email?: string;

  @ApiPropertyOptional({
    description: 'Patient city (decrypted)',
    example: 'Cape Town',
  })
  @Expose()
  city?: string;

  @ApiPropertyOptional({
    description: 'Patient address (decrypted)',
    example: '123 Main Street, Gardens',
  })
  @Expose()
  address?: string;

  @ApiPropertyOptional({
    description: 'Patient national ID (decrypted)',
    example: '9005155800088',
  })
  @Expose()
  nationalId?: string;

  // ===== IDENTIFIERS =====
  @ApiPropertyOptional({
    description: 'Patient file number',
    example: 'PAT-2024-001',
  })
  @Expose()
  fileNumber?: string;

  // ===== DEPRECATED FIELDS (DECRYPTED) =====
  @ApiPropertyOptional({
    description: 'DEPRECATED: Legacy medical aid (decrypted)',
    example: 'Discovery Health',
    deprecated: true,
  })
  @Expose()
  medicalAid?: string;

  @ApiPropertyOptional({
    description: 'DEPRECATED: Legacy membership number (decrypted)',
    example: 'MEM-123456',
    deprecated: true,
  })
  @Expose()
  membershipNumber?: string;

  // ===== STATUS FLAGS =====
  @ApiProperty({
    description: 'Patient active status',
    example: true,
  })
  @Expose()
  isActive!: boolean;

  @ApiProperty({
    description: 'Whether patient has active appointments',
    example: false,
  })
  @Expose()
  hasActiveAppointments!: boolean;

  // ===== INSURANCE INFORMATION =====
  @ApiPropertyOptional({
    description: 'Patient insurance information (if exists)',
    type: () => PatientInsuranceInfoDto,
  })
  @Expose()
  @Type(() => PatientInsuranceInfoDto)
  insurance?: PatientInsuranceInfoDto;

  // ===== AUDIT FIELDS =====
  @ApiProperty({
    description: 'Record creation timestamp',
    example: '2024-01-15T10:30:00.000Z',
    format: 'date-time',
  })
  @Expose()
  @Transform(({ value }) => (value ? new Date(value).toISOString() : null))
  createdAt!: Date;

  @ApiProperty({
    description: 'Record last update timestamp',
    example: '2024-01-15T14:45:00.000Z',
    format: 'date-time',
  })
  @Expose()
  @Transform(({ value }) => (value ? new Date(value).toISOString() : null))
  updatedAt!: Date;

  @ApiPropertyOptional({
    description: 'Soft delete timestamp',
    example: '2024-01-20T09:00:00.000Z',
    format: 'date-time',
  })
  @Expose()
  @Transform(({ value }) => (value ? new Date(value).toISOString() : null))
  deletedAt?: Date;

  // NOTE: deletedById and insuranceMigrated fields are excluded (not exposed)
  // These are internal fields not meant for API responses

  /**
   * Create PatientResponseDto from Patient entity
   * Includes all computed fields (age, fullName, formattedGender, etc.)
   *
   * @param patient - Patient entity with decrypted data
   * @returns Formatted PatientResponseDto
   */
  static fromEntity(patient: Patient): PatientResponseDto {
    const dto = new PatientResponseDto();

    // Copy all basic fields
    Object.assign(dto, patient);

    // Computed field: Full name
    dto.fullName = `${patient.firstName} ${patient.lastName}`.trim();

    // Computed field: Formatted gender
    dto.formattedGender = this.formatGender(patient.gender);

    // Computed fields: Age calculation
    const ageData = this.calculateAge(patient.birthDate);
    dto.ageYears = ageData.years;
    dto.ageMonths = ageData.months;
    dto.age = this.formatAgeString(ageData.years, ageData.months);

    // Check if patient has active appointments
    if (patient.appointments) {
      const activeStatuses = [
        AppointmentStatus.IN_PROGRESS,
        AppointmentStatus.MISSED,
        AppointmentStatus.SCHEDULED,
      ];

      dto.hasActiveAppointments = patient.appointments.some(
        (appointment) =>
          appointment.isActive && activeStatuses.includes(appointment.status as any),
      );
    } else {
      dto.hasActiveAppointments = false;
    }

    // Transform insurance to DTO (if exists)
    if (patient.insurance) {
      dto.insurance = {
        id: patient.insurance.id,
        membershipNumber: patient.insurance.membershipNumber,
        providerId: patient.insurance.insuranceProviderId,
        providerName:
          patient.insurance.insuranceProvider?.name ||
          patient.insurance.insuranceProvider?.shortName ||
          'Unknown Provider',
        providerCode: patient.insurance.insuranceProvider?.providerCode,
        schemeId: patient.insurance.schemeId,
        schemeName: patient.insurance.scheme?.schemeName || 'Unknown Scheme',
        schemeCode: patient.insurance.scheme?.schemeCode,
        memberType: patient.insurance.memberType,
        status: patient.insurance.status,
        isPrimary: patient.insurance.isPrimary,
        priority: patient.insurance.priority,
        effectiveDate: patient.insurance.effectiveDate,
        expiryDate: patient.insurance.expiryDate,
        currentAuthorizationNumber: patient.insurance.currentAuthorizationNumber,
        authorizationExpiryDate: patient.insurance.authorizationExpiryDate,
      };
    }

    return dto;
  }

  /**
   * Calculate patient's age from birth date
   * Business logic moved from Patient entity
   *
   * @param birthDate - Birth date string (YYYY-MM-DD)
   * @returns Age object with years and months
   */
  private static calculateAge(birthDate: string): { years: number; months: number } {
    if (!birthDate) {
      return { years: 0, months: 0 };
    }

    const birth = new Date(birthDate);
    const today = new Date();

    let years = today.getFullYear() - birth.getFullYear();
    let months = today.getMonth() - birth.getMonth();

    if (months < 0 || (months === 0 && today.getDate() < birth.getDate())) {
      years--;
      months += 12;
    }

    if (today.getDate() < birth.getDate()) {
      months--;
    }

    return { years, months };
  }

  /**
   * Format age as a human-readable string
   * Business logic moved from Patient entity
   *
   * @param years - Age in years
   * @param months - Age months component
   * @returns Formatted age string
   */
  private static formatAgeString(years: number, months: number): string {
    if (years === 0) {
      return `${months} month${months !== 1 ? 's' : ''}`;
    }

    if (years < 2) {
      return `${years} year${years !== 1 ? 's' : ''}, ${months} month${months !== 1 ? 's' : ''}`;
    }

    return `${years} years`;
  }

  /**
   * Format gender for display
   *
   * @param gender - Gender enum value
   * @returns Formatted gender string
   */
  private static formatGender(gender: string): string {
    const genderMap: Record<string, string> = {
      MALE: 'Male',
      FEMALE: 'Female',
      OTHER: 'Other',
      UNSPECIFIED: 'Unspecified',
    };

    return genderMap[gender] || gender;
  }
}
