import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PatientListResponseDto } from './patient-list-response.dto';

/**
 * Pagination Metadata DTO
 * Contains pagination information for list responses
 */
class PaginationMetaDto {
  @ApiProperty({
    description: 'Total number of items across all pages',
    example: 150,
    minimum: 0,
  })
  total!: number;

  @ApiProperty({
    description: 'Current page number (1-indexed)',
    example: 1,
    minimum: 1,
  })
  page!: number;

  @ApiProperty({
    description: 'Number of items per page',
    example: 10,
    minimum: 1,
  })
  limit!: number;

  @ApiProperty({
    description: 'Total number of pages',
    example: 15,
    minimum: 0,
  })
  totalPages!: number;
}

/**
 * Search Metadata DTO
 * Contains information about search execution and performance
 */
export class SearchMetadataDto {
  @ApiPropertyOptional({
    description: 'Search term used',
    example: 'John',
  })
  searchTerm?: string;

  @ApiPropertyOptional({
    description: 'Search method used (e.g., "database", "cache", "full-text")',
    example: 'database',
  })
  searchMethod?: string;

  @ApiPropertyOptional({
    description: 'Query execution time in milliseconds',
    example: 45,
    minimum: 0,
  })
  executionTime?: number;

  @ApiPropertyOptional({
    description: 'Whether result was served from cache',
    example: false,
  })
  cacheHit?: boolean;

  @ApiPropertyOptional({
    description: 'Number of filters applied',
    example: 3,
    minimum: 0,
  })
  filtersApplied?: number;
}

/**
 * Paginated Patients Response DTO
 * Standard paginated list response for patient queries
 *
 * Features:
 * - Array of lightweight patient list items
 * - Comprehensive pagination metadata
 * - Optional search performance metadata
 * - Type-safe structure
 *
 * Use cases:
 * - Patient search results
 * - Patient list endpoints
 * - Filtered patient queries
 */
export class PaginatedPatientsResponseDto {
  @ApiProperty({
    description: 'Array of patient list items',
    type: [PatientListResponseDto],
    isArray: true,
  })
  @Type(() => PatientListResponseDto)
  data!: PatientListResponseDto[];

  @ApiProperty({
    description: 'Pagination metadata',
    type: PaginationMetaDto,
  })
  @Type(() => PaginationMetaDto)
  meta!: PaginationMetaDto;

  @ApiPropertyOptional({
    description: 'Search execution metadata (optional)',
    type: SearchMetadataDto,
  })
  @Type(() => SearchMetadataDto)
  searchMetadata?: SearchMetadataDto;

  /**
   * Create paginated response from data and counts
   *
   * @param data - Array of patient list items
   * @param total - Total number of items
   * @param page - Current page number
   * @param limit - Items per page
   * @param searchMetadata - Optional search metadata
   * @returns Formatted paginated response
   */
  static create(
    data: PatientListResponseDto[],
    total: number,
    page: number,
    limit: number,
    searchMetadata?: SearchMetadataDto,
  ): PaginatedPatientsResponseDto {
    const response = new PaginatedPatientsResponseDto();

    response.data = data;

    response.meta = {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };

    if (searchMetadata) {
      response.searchMetadata = searchMetadata;
    }

    return response;
  }
}
