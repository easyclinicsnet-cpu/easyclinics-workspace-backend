import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { Gender } from '../../constants/patient.constants';

/**
 * Patient List Response DTO
 * Lightweight DTO optimized for list views and search results
 *
 * Features:
 * - Essential fields only (no relationships)
 * - Minimal computed fields for performance
 * - Optimized for pagination and filtering
 * - Smaller payload than PatientResponseDto
 *
 * Use cases:
 * - Patient search results
 * - Patient lists/tables
 * - Quick lookups
 * - Dropdown selections
 */
@Exclude()
export class PatientListResponseDto {
  // ===== IDENTIFIERS =====
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
    description: 'Patient file number',
    example: 'PAT-2024-001',
  })
  @Expose()
  fileNumber?: string;

  // ===== CORE DEMOGRAPHICS =====
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
    description: 'Patient gender (decrypted)',
    enum: Gender,
    example: Gender.MALE,
  })
  @Expose()
  gender!: string;

  @ApiProperty({
    description: 'Patient birth date (decrypted)',
    example: '1990-05-15',
    format: 'date',
  })
  @Expose()
  birthDate!: string;

  // ===== COMPUTED FIELD =====
  @ApiProperty({
    description: 'Computed field: Age as formatted string',
    example: '33 years',
  })
  @Expose()
  age!: string;

  // ===== CONTACT INFO (MINIMAL) =====
  @ApiPropertyOptional({
    description: 'Patient phone number (decrypted)',
    example: '+27821234567',
  })
  @Expose()
  phoneNumber?: string;

  // ===== STATUS =====
  @ApiProperty({
    description: 'Patient active status',
    example: true,
  })
  @Expose()
  isActive!: boolean;

  // NOTE: No relationships, no audit fields, no insurance details
  // This keeps the payload small for list views
}
