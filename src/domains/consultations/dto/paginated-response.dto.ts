/**
 * Generic paginated response DTO
 * Used for all paginated API responses
 */
export class PaginatedResponseDto<T> {
  data!: T[];
  meta!: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
