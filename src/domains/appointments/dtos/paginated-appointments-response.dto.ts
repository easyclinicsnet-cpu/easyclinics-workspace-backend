import { ApiProperty } from '@nestjs/swagger';
import { AppointmentResponseDto } from './appointment-response.dto';

/**
 * Pagination metadata
 */
export class PaginationMeta {
  @ApiProperty({ description: 'Total number of records' })
  total!: number;

  @ApiProperty({ description: 'Current page number' })
  page!: number;

  @ApiProperty({ description: 'Records per page' })
  limit!: number;

  @ApiProperty({ description: 'Total number of pages' })
  totalPages!: number;
}

/**
 * Search metadata for encrypted search operations
 */
export class SearchMetadata {
  @ApiProperty({ description: 'Search term used' })
  searchTerm!: string;

  @ApiProperty({ description: 'Search method used', enum: ['encrypted', 'standard'] })
  searchMethod!: 'encrypted' | 'standard';

  @ApiProperty({ description: 'Execution time in milliseconds' })
  executionTime!: number;

  @ApiProperty({ description: 'Whether result was from cache' })
  cacheHit!: boolean;
}

/**
 * Paginated response for appointments
 */
export class PaginatedAppointmentsResponseDto {
  @ApiProperty({ type: [AppointmentResponseDto], description: 'Array of appointments' })
  data!: AppointmentResponseDto[];

  @ApiProperty({ type: PaginationMeta, description: 'Pagination metadata' })
  meta!: PaginationMeta;

  @ApiProperty({
    type: SearchMetadata,
    description: 'Search metadata (only present when searching)',
    required: false,
  })
  searchMetadata?: SearchMetadata;
}
