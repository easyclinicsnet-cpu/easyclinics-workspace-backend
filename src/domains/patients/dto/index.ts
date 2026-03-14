// Patient DTOs
export * from './patient';

// Allergy DTOs
export * from './allergy';

// Vital DTOs
export * from './vital';

// History DTOs (Medical & Surgical)
export * from './history';

// Social History DTOs
export * from './social-history';

// Family Condition DTOs
export * from './family-condition';

// Common DTOs
export * from './common';

// Legacy exports for backward compatibility
export { CreatePatientDto } from './patient/create-patient.dto';
export { UpdatePatientDto } from './patient/update-patient.dto';
export { PatientResponseDto } from './patient/patient-response.dto';
export { QueryPatientsDto } from './patient/query-patients.dto';
export { PaginatedPatientsResponseDto } from './patient/paginated-patients-response.dto';
export { PatientListResponseDto as SimplePatientDto } from './patient/patient-list-response.dto';
