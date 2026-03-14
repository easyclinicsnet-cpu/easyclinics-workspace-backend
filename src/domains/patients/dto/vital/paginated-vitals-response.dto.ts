import { ApiProperty } from '@nestjs/swagger';
import { VitalResponseDto } from './vital-response.dto';

export class PaginatedVitalsResponseDto {
  @ApiProperty({ type: [VitalResponseDto] })
  data!: VitalResponseDto[];

  @ApiProperty({
    description: 'Pagination metadata',
    example: {
      total: 100,
      page: 1,
      limit: 10,
      totalPages: 10,
    },
  })
  meta!: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
