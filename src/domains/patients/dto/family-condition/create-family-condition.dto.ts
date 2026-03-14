import { IsString, IsNotEmpty, IsOptional, IsUUID, IsNumber, IsBoolean, IsEnum, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * Standardized relationship types per HL7 v3 Family Member
 */
export enum RelationshipType {
  MOTHER = 'Mother',
  FATHER = 'Father',
  SIBLING = 'Sibling',
  CHILD = 'Child',
  GRANDPARENT = 'Grandparent',
  GRANDMOTHER = 'Grandmother',
  GRANDFATHER = 'Grandfather',
  AUNT = 'Aunt',
  UNCLE = 'Uncle',
  COUSIN = 'Cousin',
  HALF_SIBLING = 'Half-Sibling',
  GRANDCHILD = 'Grandchild',
  GREAT_GRANDPARENT = 'Great-Grandparent',
  GREAT_AUNT = 'Great-Aunt',
  GREAT_UNCLE = 'Great-Uncle',
  NIECE = 'Niece',
  NEPHEW = 'Nephew',
}

export class CreateFamilyConditionDto {
  @ApiProperty({
    description: 'Family member relationship to patient (standardized per HL7 v3)',
    enum: RelationshipType,
    example: 'Mother'
  })
  @IsEnum(RelationshipType)
  @IsNotEmpty()
  relationshipToPatient!: RelationshipType;

  @ApiProperty({ description: 'Medical condition (free text or SNOMED CT)', example: 'Breast Cancer' })
  @IsString()
  @IsNotEmpty()
  condition!: string;

  @ApiPropertyOptional({ description: 'SNOMED CT code for condition', example: '254837009' })
  @IsString()
  @IsOptional()
  snomedCode?: string;

  @ApiPropertyOptional({ description: 'Age when condition was diagnosed', example: 45, minimum: 0, maximum: 120 })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @Max(120)
  ageOfOnset?: number;

  @ApiPropertyOptional({ description: 'Current age of family member', example: 65, minimum: 0, maximum: 120 })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @Max(120)
  currentAge?: number;

  @ApiPropertyOptional({ description: 'Whether family member is deceased', example: false })
  @IsBoolean()
  @IsOptional()
  isDeceased?: boolean;

  @ApiPropertyOptional({ description: 'Cause of death if deceased', example: 'Heart Attack' })
  @IsString()
  @IsOptional()
  causeOfDeath?: string;

  @ApiPropertyOptional({ description: 'Additional notes (encrypted)', example: 'Diagnosed at age 45, underwent treatment' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ description: 'ID of the patient' })
  @IsUUID()
  @IsNotEmpty()
  patientId!: string;

  // workspaceId and userId will be injected by service from JWT context
}
