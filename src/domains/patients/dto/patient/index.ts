/**
 * Patient DTOs - Barrel Export
 * Centralized export point for all patient-related Data Transfer Objects
 *
 * Organization:
 * - Request DTOs: Create, Update, Query
 * - Response DTOs: Single, List, Paginated, With Details
 * - Supporting DTOs: Insurance Info, Pagination Meta, Search Meta
 */

// ===== REQUEST DTOs =====
export * from './create-patient.dto';
export * from './update-patient.dto';
export * from './query-patients.dto';

// ===== RESPONSE DTOs =====
export * from './patient-response.dto';
export * from './patient-list-response.dto';
export * from './patient-with-details-response.dto';

// ===== PAGINATED RESPONSE =====
export * from './paginated-patients-response.dto';

// ===== SUPPORTING DTOs =====
export * from './patient-insurance-info.dto';

// ===== DASHBOARD DTO =====
export * from './patient-dashboard-response.dto';

// ===== LEGACY EXPORTS (for backward compatibility) =====
// Note: Kept for any existing code that might be using old import names
export { QueryPatientsDto as PatientQueryDto } from './query-patients.dto';
