import { ApiProperty } from '@nestjs/swagger';
import { FamilyConditionResponseDto } from './family-condition-response.dto';

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

export class PaginatedFamilyConditionsResponseDto {
  @ApiProperty({ type: [FamilyConditionResponseDto], description: 'Array of family conditions' })
  data!: FamilyConditionResponseDto[];

  @ApiProperty({ type: PaginationMeta, description: 'Pagination metadata' })
  meta!: PaginationMeta;
}
