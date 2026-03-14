import { ApiProperty } from '@nestjs/swagger';
import { MedicalHistoryResponseDto } from './medical-history-response.dto';

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

export class PaginatedMedicalHistoryResponseDto {
  @ApiProperty({ type: [MedicalHistoryResponseDto], description: 'Array of medical histories' })
  data!: MedicalHistoryResponseDto[];

  @ApiProperty({ type: PaginationMeta, description: 'Pagination metadata' })
  meta!: PaginationMeta;
}
