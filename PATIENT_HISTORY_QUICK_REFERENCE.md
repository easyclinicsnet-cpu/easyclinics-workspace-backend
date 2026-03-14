# Patient History Services - Quick Reference Guide

## Service Methods Quick Reference

### AllergiesService

```typescript
// Create allergy
create(dto: CreateAllergyDto, userId: string, workspaceId: string): Promise<AllergyResponseDto>

// Find all with filters
findAll(query: AllergyQueryDto, workspaceId: string): Promise<PaginatedAllergiesResponseDto>

// Find by patient
findByPatient(patientId: string, workspaceId: string, page?: number, limit?: number): Promise<PaginatedAllergiesResponseDto>

// Find one
findOne(id: string, workspaceId: string): Promise<AllergyResponseDto>

// Update
update(id: string, dto: UpdateAllergyDto, userId: string, workspaceId: string): Promise<AllergyResponseDto>

// Soft delete
remove(id: string, userId: string, workspaceId: string): Promise<void>

// Find by severity
findBySeverity(severity: Severity, workspaceId: string, page?: number, limit?: number): Promise<PaginatedAllergiesResponseDto>

// Find active only
findActive(workspaceId: string, page?: number, limit?: number): Promise<PaginatedAllergiesResponseDto>
```

---

### SocialHistoryService

```typescript
// Create social history (deactivates previous)
create(dto: CreateSocialHistoryDto, userId: string, workspaceId: string): Promise<SocialHistoryResponseDto>

// Find latest by patient
findByPatient(patientId: string, workspaceId: string): Promise<SocialHistoryResponseDto>

// Find one
findOne(id: string, workspaceId: string): Promise<SocialHistoryResponseDto>

// Update
update(id: string, dto: UpdateSocialHistoryDto, userId: string, workspaceId: string): Promise<SocialHistoryResponseDto>

// Soft delete
remove(id: string, userId: string, workspaceId: string): Promise<void>

// Find by smoking status
findBySmokingStatus(status: SmokingStatus, workspaceId: string, page?: number, limit?: number): Promise<PaginatedSocialHistoryResponseDto>

// Find by alcohol use
findByAlcoholUse(use: AlcoholUse, workspaceId: string, page?: number, limit?: number): Promise<PaginatedSocialHistoryResponseDto>

// Find high-risk patients
findRiskPatients(workspaceId: string, page?: number, limit?: number): Promise<PaginatedSocialHistoryResponseDto>
```

---

### MedicalHistoryService

```typescript
// Create medical history
create(dto: CreateMedicalHistoryDto, userId: string, workspaceId: string): Promise<MedicalHistoryResponseDto>

// Find all with filters
findAll(query: MedicalHistoryQueryDto, workspaceId: string): Promise<PaginatedMedicalHistoryResponseDto>

// Find by patient
findByPatient(patientId: string, workspaceId: string, page?: number, limit?: number): Promise<PaginatedMedicalHistoryResponseDto>

// Find one
findOne(id: string, workspaceId: string): Promise<MedicalHistoryResponseDto>

// Update
update(id: string, dto: UpdateMedicalHistoryDto, userId: string, workspaceId: string): Promise<MedicalHistoryResponseDto>

// Soft delete
remove(id: string, userId: string, workspaceId: string): Promise<void>

// Find active only
findActive(workspaceId: string, page?: number, limit?: number): Promise<PaginatedMedicalHistoryResponseDto>

// Find chronic conditions
findChronic(patientId: string, workspaceId: string): Promise<MedicalHistoryResponseDto[]>
```

---

### SurgicalHistoryService

```typescript
// Create surgical history
create(dto: CreateSurgicalHistoryDto, userId: string, workspaceId: string): Promise<SurgicalHistoryResponseDto>

// Find all with filters
findAll(query: SurgicalHistoryQueryDto, workspaceId: string): Promise<PaginatedSurgicalHistoryResponseDto>

// Find by patient
findByPatient(patientId: string, workspaceId: string, page?: number, limit?: number): Promise<PaginatedSurgicalHistoryResponseDto>

// Find one
findOne(id: string, workspaceId: string): Promise<SurgicalHistoryResponseDto>

// Update
update(id: string, dto: UpdateSurgicalHistoryDto, userId: string, workspaceId: string): Promise<SurgicalHistoryResponseDto>

// Soft delete
remove(id: string, userId: string, workspaceId: string): Promise<void>

// Find recent surgeries
findRecent(workspaceId: string, days: number, page?: number, limit?: number): Promise<PaginatedSurgicalHistoryResponseDto>

// Find with complications
findWithComplications(workspaceId: string, page?: number, limit?: number): Promise<PaginatedSurgicalHistoryResponseDto>
```

---

## DTOs Quick Reference

### CreateAllergyDto
```typescript
{
  substance: string;        // Required - allergen name
  reaction: string;         // Required - reaction description
  severity: Severity;       // Required - MILD, MODERATE, SEVERE, LIFE_THREATENING
  patientId: string;        // Required - UUID
}
```

### CreateSocialHistoryDto
```typescript
{
  patientId: string;           // Required - UUID
  smokingStatus: SmokingStatus; // NEVER, CURRENT, FORMER
  alcoholUse: AlcoholUse;       // NEVER, OCCASIONALLY, REGULARLY, FORMER
  drugUse: DrugUse;             // NEVER, CURRENT, FORMER
  occupation?: string;          // Optional - free text or ISCO-08 code
  additionalNotes?: string;     // Optional - encrypted field
}
```

### CreateMedicalHistoryDto
```typescript
{
  condition: string;    // Required - condition name or ICD-10/SNOMED code
  details?: string;     // Optional - additional details
  patientId: string;    // Required - UUID
}
```

### CreateSurgicalHistoryDto
```typescript
{
  procedure: string;    // Required - procedure name or CPT/ICD-10-PCS code
  details?: string;     // Optional - complications, notes
  date?: string;        // Optional - ISO 8601 date (YYYY-MM-DD), cannot be future
  patientId: string;    // Required - UUID
}
```

### Query DTOs
```typescript
// AllergyQueryDto
{
  page?: number;        // Default: 1
  limit?: number;       // Default: 10, Max: 100
  patientId?: string;   // Filter by patient
  substance?: string;   // Search by substance
  severity?: Severity;  // Filter by severity
  sortBy?: string;      // Default: 'createdAt'
  sortDirection?: 'ASC' | 'DESC'; // Default: 'DESC'
}

// MedicalHistoryQueryDto
{
  page?: number;
  limit?: number;
  patientId?: string;
  condition?: string;   // Search by condition
  sortBy?: string;
  sortDirection?: 'ASC' | 'DESC';
}

// SurgicalHistoryQueryDto
{
  page?: number;
  limit?: number;
  patientId?: string;
  procedure?: string;   // Search by procedure
  recentDays?: number;  // Filter recent surgeries
  withComplications?: boolean; // Filter complications
  sortBy?: string;
  sortDirection?: 'ASC' | 'DESC';
}
```

---

## Enums Quick Reference

### Severity
```typescript
enum Severity {
  MILD = 'Mild',
  MODERATE = 'Moderate',
  SEVERE = 'Severe',
  LIFE_THREATENING = 'Life-threatening',
}
```

### SmokingStatus
```typescript
enum SmokingStatus {
  NEVER = 'Never',
  CURRENT = 'Current',
  FORMER = 'Former',
}
```

### AlcoholUse
```typescript
enum AlcoholUse {
  NEVER = 'Never',
  OCCASIONALLY = 'Occasionally',
  REGULARLY = 'Regularly',
  FORMER = 'Former',
}
```

### DrugUse
```typescript
enum DrugUse {
  NEVER = 'Never',
  CURRENT = 'Current',
  FORMER = 'Former',
}
```

---

## Pagination Response Format

```typescript
{
  data: Array<ResponseDto>,  // Array of entities
  meta: {
    total: number,           // Total count
    page: number,            // Current page
    limit: number,           // Items per page
    totalPages: number       // Total pages
  }
}
```

---

## Error Codes

### 404 Not Found
- "Patient with ID {id} not found"
- "Allergy with ID {id} not found"
- "Social history with ID {id} not found"
- "Medical history with ID {id} not found"
- "Surgical history with ID {id} not found"

### 409 Conflict
- "Duplicate allergy: {substance} already exists for this patient"

### 400 Bad Request
- "Invalid date: surgery date cannot be in the future"
- "Days must be a positive number"

---

## Audit Actions

### Allergy
- `CREATE_ALLERGY`
- `UPDATE_ALLERGY`
- `VIEW_ALLERGY`
- `DELETE_ALLERGY`

### Social History
- `CREATE_SOCIAL_HISTORY`
- `UPDATE_SOCIAL_HISTORY`
- `VIEW_SOCIAL_HISTORY`
- `DELETE_SOCIAL_HISTORY`

### Medical History
- `CREATE_MEDICAL_HISTORY`
- `UPDATE_MEDICAL_HISTORY`
- `VIEW_MEDICAL_HISTORY`
- `DELETE_MEDICAL_HISTORY`

### Surgical History
- `CREATE_SURGICAL_HISTORY`
- `UPDATE_SURGICAL_HISTORY`
- `VIEW_SURGICAL_HISTORY`
- `DELETE_SURGICAL_HISTORY`

---

## Chronic Conditions Detected

The system automatically identifies these chronic conditions:
- diabetes
- hypertension
- asthma
- copd
- heart disease
- chronic kidney disease
- epilepsy
- chronic pain
- arthritis
- hypothyroidism
- hyperthyroidism

---

## Complications Keywords Detected

The system automatically identifies surgeries with these complications:
- complication
- infection
- bleeding
- hemorrhage
- sepsis
- failure
- adverse
- problem
- re-operation
- revision

---

## High-Risk Social Factors

Patients are flagged as high-risk if they have:
- **Smoking Status**: CURRENT
- **OR Alcohol Use**: REGULARLY
- **OR Drug Use**: CURRENT

---

## Import Statements

### For Services
```typescript
import { AllergiesService } from '@domains/patients/services';
import { SocialHistoryService } from '@domains/patients/services';
import { MedicalHistoryService } from '@domains/patients/services';
import { SurgicalHistoryService } from '@domains/patients/services';
```

### For DTOs
```typescript
import {
  CreateAllergyDto,
  UpdateAllergyDto,
  AllergyQueryDto,
  AllergyResponseDto,
  PaginatedAllergiesResponseDto,
} from '@domains/patients/dto';

import {
  CreateSocialHistoryDto,
  UpdateSocialHistoryDto,
  SocialHistoryQueryDto,
  SocialHistoryResponseDto,
  PaginatedSocialHistoryResponseDto,
} from '@domains/patients/dto';

import {
  CreateMedicalHistoryDto,
  UpdateMedicalHistoryDto,
  MedicalHistoryQueryDto,
  MedicalHistoryResponseDto,
  PaginatedMedicalHistoryResponseDto,
} from '@domains/patients/dto';

import {
  CreateSurgicalHistoryDto,
  UpdateSurgicalHistoryDto,
  SurgicalHistoryQueryDto,
  SurgicalHistoryResponseDto,
  PaginatedSurgicalHistoryResponseDto,
} from '@domains/patients/dto';
```

### For Enums
```typescript
import {
  Severity,
  SmokingStatus,
  AlcoholUse,
  DrugUse,
} from '@common/enums';
```

---

## Usage Examples

### Creating Records
```typescript
// Allergy
const allergy = await allergiesService.create(
  { substance: 'Penicillin', reaction: 'Hives', severity: Severity.MODERATE, patientId },
  userId,
  workspaceId
);

// Social History
const socialHistory = await socialHistoryService.create(
  { patientId, smokingStatus: SmokingStatus.CURRENT, alcoholUse: AlcoholUse.NEVER, drugUse: DrugUse.NEVER },
  userId,
  workspaceId
);

// Medical History
const medicalHistory = await medicalHistoryService.create(
  { condition: 'Type 2 Diabetes', details: 'Diagnosed 2020', patientId },
  userId,
  workspaceId
);

// Surgical History
const surgicalHistory = await surgicalHistoryService.create(
  { procedure: 'Appendectomy', date: '2024-01-15', patientId },
  userId,
  workspaceId
);
```

### Querying Records
```typescript
// Get patient allergies
const allergies = await allergiesService.findByPatient(patientId, workspaceId, 1, 10);

// Get chronic conditions
const chronic = await medicalHistoryService.findChronic(patientId, workspaceId);

// Get recent surgeries (last 30 days)
const recent = await surgicalHistoryService.findRecent(workspaceId, 30, 1, 10);

// Get high-risk patients
const highRisk = await socialHistoryService.findRiskPatients(workspaceId, 1, 10);
```

---

*Quick Reference Guide - February 16, 2026*
