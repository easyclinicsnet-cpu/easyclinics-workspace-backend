import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Transform } from 'class-transformer';

/**
 * Patient Insurance Info DTO
 * Nested DTO for patient insurance information in response objects
 *
 * Used as part of PatientResponseDto and PatientWithDetailsResponseDto
 * Contains all relevant insurance details for display purposes
 */
export class PatientInsuranceInfoDto {
  @ApiProperty({
    description: 'Patient insurance record ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
  })
  @Expose()
  id!: string;

  @ApiProperty({
    description: 'Insurance membership number',
    example: 'INS-2024-001',
  })
  @Expose()
  membershipNumber!: string;

  // ===== PROVIDER INFORMATION =====
  @ApiProperty({
    description: 'Insurance provider ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
  })
  @Expose()
  providerId!: string;

  @ApiProperty({
    description: 'Insurance provider name',
    example: 'Discovery Health',
  })
  @Expose()
  providerName!: string;

  @ApiPropertyOptional({
    description: 'Insurance provider code',
    example: 'DH',
  })
  @Expose()
  providerCode?: string;

  // ===== SCHEME INFORMATION =====
  @ApiProperty({
    description: 'Insurance scheme ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
  })
  @Expose()
  schemeId!: string;

  @ApiProperty({
    description: 'Insurance scheme name',
    example: 'KeyCare Plus',
  })
  @Expose()
  schemeName!: string;

  @ApiPropertyOptional({
    description: 'Insurance scheme code',
    example: 'KCP',
  })
  @Expose()
  schemeCode?: string;

  // ===== MEMBERSHIP DETAILS =====
  @ApiProperty({
    description: 'Member type (PRINCIPAL or DEPENDENT)',
    enum: ['PRINCIPAL', 'DEPENDENT'],
    example: 'PRINCIPAL',
  })
  @Expose()
  memberType!: 'PRINCIPAL' | 'DEPENDENT';

  @ApiProperty({
    description: 'Insurance status',
    enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'EXPIRED'],
    example: 'ACTIVE',
  })
  @Expose()
  status!: string;

  @ApiProperty({
    description: 'Whether this is the primary insurance',
    example: true,
  })
  @Expose()
  isPrimary!: boolean;

  @ApiProperty({
    description: 'Insurance priority (1 = primary, 2 = secondary, etc.)',
    example: 1,
    minimum: 1,
  })
  @Expose()
  priority!: number;

  // ===== DATES =====
  @ApiProperty({
    description: 'Insurance effective date',
    example: '2024-01-01',
    format: 'date',
  })
  @Expose()
  @Transform(({ value }) => (value ? new Date(value).toISOString().split('T')[0] : null))
  effectiveDate!: Date;

  @ApiProperty({
    description: 'Insurance expiry date',
    example: '2024-12-31',
    format: 'date',
  })
  @Expose()
  @Transform(({ value }) => (value ? new Date(value).toISOString().split('T')[0] : null))
  expiryDate!: Date;

  // ===== AUTHORIZATION =====
  @ApiPropertyOptional({
    description: 'Current pre-authorization number',
    example: 'AUTH-2024-001',
  })
  @Expose()
  currentAuthorizationNumber?: string;

  @ApiPropertyOptional({
    description: 'Authorization expiry date',
    example: '2024-06-30',
    format: 'date',
  })
  @Expose()
  @Transform(({ value }) => (value ? new Date(value).toISOString().split('T')[0] : null))
  authorizationExpiryDate?: Date;
}
