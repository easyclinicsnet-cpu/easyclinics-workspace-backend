import { IsString, IsOptional, IsNumber, IsBoolean, IsEnum, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { RelationshipType } from './create-family-condition.dto';

export class UpdateFamilyConditionDto {
  @ApiPropertyOptional({
    description: 'Family member relationship to patient (standardized per HL7 v3)',
    enum: RelationshipType
  })
  @IsEnum(RelationshipType)
  @IsOptional()
  relationshipToPatient?: RelationshipType;

  @ApiPropertyOptional({ description: 'Medical condition (free text or SNOMED CT)' })
  @IsString()
  @IsOptional()
  condition?: string;

  @ApiPropertyOptional({ description: 'SNOMED CT code for condition' })
  @IsString()
  @IsOptional()
  snomedCode?: string;

  @ApiPropertyOptional({ description: 'Age when condition was diagnosed', minimum: 0, maximum: 120 })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @Max(120)
  ageOfOnset?: number;

  @ApiPropertyOptional({ description: 'Current age of family member', minimum: 0, maximum: 120 })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @Max(120)
  currentAge?: number;

  @ApiPropertyOptional({ description: 'Whether family member is deceased' })
  @IsBoolean()
  @IsOptional()
  isDeceased?: boolean;

  @ApiPropertyOptional({ description: 'Cause of death if deceased' })
  @IsString()
  @IsOptional()
  causeOfDeath?: string;

  @ApiPropertyOptional({ description: 'Additional notes (encrypted)' })
  @IsString()
  @IsOptional()
  notes?: string;
}
