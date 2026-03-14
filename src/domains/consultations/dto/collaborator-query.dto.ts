import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsEnum, IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { CollaborationRole } from '../../../common/enums';

/**
 * DTO for querying consultation collaborators
 */
export class CollaboratorQueryDto {
  @ApiPropertyOptional({ description: 'Filter by consultation ID' })
  @IsUUID()
  @IsOptional()
  consultationId?: string;

  @ApiPropertyOptional({ enum: CollaborationRole, description: 'Filter by role' })
  @IsEnum(CollaborationRole)
  @IsOptional()
  role?: CollaborationRole;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 10;

  @ApiPropertyOptional({ default: 'createdAt' })
  @IsString()
  @IsOptional()
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'], default: 'DESC' })
  @IsEnum(['ASC', 'DESC'])
  @IsOptional()
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}
