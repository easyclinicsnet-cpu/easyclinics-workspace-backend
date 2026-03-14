import { ApiProperty } from '@nestjs/swagger';
import { AllergyResponseDto } from './allergy-response.dto';

class PaginationMeta {
  @ApiProperty({ description: 'Total number of items' })
  total!: number;

  @ApiProperty({ description: 'Current page number' })
  page!: number;

  @ApiProperty({ description: 'Number of items per page' })
  limit!: number;

  @ApiProperty({ description: 'Total number of pages' })
  totalPages!: number;
}

export class PaginatedAllergiesResponseDto {
  @ApiProperty({ type: [AllergyResponseDto], description: 'Array of allergies' })
  data!: AllergyResponseDto[];

  @ApiProperty({ type: PaginationMeta, description: 'Pagination metadata' })
  meta!: PaginationMeta;
}
