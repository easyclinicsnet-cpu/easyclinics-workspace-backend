import { ApiProperty } from '@nestjs/swagger';
import { SurgicalHistoryResponseDto } from './surgical-history-response.dto';

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

export class PaginatedSurgicalHistoryResponseDto {
  @ApiProperty({ type: [SurgicalHistoryResponseDto], description: 'Array of surgical histories' })
  data!: SurgicalHistoryResponseDto[];

  @ApiProperty({ type: PaginationMeta, description: 'Pagination metadata' })
  meta!: PaginationMeta;
}
