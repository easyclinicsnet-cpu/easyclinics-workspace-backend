import { ApiProperty } from '@nestjs/swagger';
import { SocialHistoryResponseDto } from './social-history-response.dto';

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

export class PaginatedSocialHistoryResponseDto {
  @ApiProperty({ type: [SocialHistoryResponseDto], description: 'Array of social histories' })
  data!: SocialHistoryResponseDto[];

  @ApiProperty({ type: PaginationMeta, description: 'Pagination metadata' })
  meta!: PaginationMeta;
}
