/**
 * Insurance Domain Interfaces
 */

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface IPaginationMeta {
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
}

export interface IPaginatedResult<T> {
  data: T[];
  meta: IPaginationMeta;
}
