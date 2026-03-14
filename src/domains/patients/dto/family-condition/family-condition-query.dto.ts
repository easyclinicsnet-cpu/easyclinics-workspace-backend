import { IsOptional, IsPositive, IsString, IsUUID, IsEnum } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { RelationshipType } from './create-family-condition.dto';

export class FamilyConditionQueryDto {
  @ApiPropertyOptional({ description: 'Page number for pagination', default: 1 })
  @IsOptional()
  @IsPositive()
  @Transform(({ value }) => parseInt(value))
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Number of items per page', default: 10 })
  @IsOptional()
  @IsPositive()
  @Transform(({ value }) => parseInt(value))
  limit?: number = 10;

  @ApiPropertyOptional({ description: 'Filter by patient ID' })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({ description: 'Filter by relationship', enum: RelationshipType })
  @IsOptional()
  @IsEnum(RelationshipType)
  relationshipToPatient?: RelationshipType;

  @ApiPropertyOptional({ description: 'Filter by condition' })
  @IsOptional()
  @IsString()
  condition?: string;

  @ApiPropertyOptional({ description: 'Search term for conditions' })
  @IsOptional()
  @IsString()
  searchTerm?: string;

  @ApiPropertyOptional({ description: 'Sort field', enum: ['relationshipToPatient', 'condition', 'createdAt'], default: 'createdAt' })
  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({ description: 'Sort direction', enum: ['ASC', 'DESC'], default: 'DESC' })
  @IsOptional()
  @IsString()
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}
