# Family Conditions - Quick Reference Guide

## Service Methods

### FamilyConditionsService

```typescript
// Create
await familyConditionsService.create(dto, userId, workspaceId);

// Find All (with filters)
await familyConditionsService.findAll(query, workspaceId);

// Find by Patient
await familyConditionsService.findByPatient(patientId, workspaceId, page, limit);

// Find One
await familyConditionsService.findOne(id, workspaceId);

// Update
await familyConditionsService.update(id, dto, userId, workspaceId);

// Delete (soft)
await familyConditionsService.remove(id, userId, workspaceId);

// Find by Condition
await familyConditionsService.findByCondition('Diabetes', workspaceId, page, limit);

// Find by Relationship
await familyConditionsService.findByRelationship('Mother', workspaceId, page, limit);

// Pattern Analysis (Risk Assessment)
await familyConditionsService.getPatternAnalysis(patientId, workspaceId);
```

### Via PatientHistoryService (Facade)

```typescript
// All methods available through facade
await patientHistoryService.createFamilyCondition(dto, userId, workspaceId);
await patientHistoryService.findPatientFamilyConditions(patientId, workspaceId);
await patientHistoryService.getPatternAnalysis(patientId, workspaceId);
```

## DTOs

### CreateFamilyConditionDto
```typescript
{
  relationshipToPatient: RelationshipType, // Required - enum
  condition: string,                        // Required
  snomedCode?: string,                      // Optional - SNOMED CT code
  ageOfOnset?: number,                      // Optional - 0-120
  currentAge?: number,                      // Optional - 0-120
  isDeceased?: boolean,                     // Optional
  causeOfDeath?: string,                    // Optional - requires isDeceased=true
  notes?: string,                           // Optional
  patientId: string,                        // Required - UUID
}
```

### Relationship Types (HL7 v3 Standard)
```typescript
enum RelationshipType {
  MOTHER, FATHER, SIBLING, CHILD,              // 1st degree
  GRANDPARENT, GRANDMOTHER, GRANDFATHER,        // 2nd degree
  AUNT, UNCLE, COUSIN,                          // 2nd/3rd degree
  HALF_SIBLING, GRANDCHILD,                     // 2nd degree
  GREAT_GRANDPARENT, GREAT_AUNT, GREAT_UNCLE,   // 3rd degree
  NIECE, NEPHEW                                 // 2nd degree
}
```

## Repository Methods

### FamilyConditionRepository

```typescript
// Find by Patient
await repository.findByPatient(patientId, workspaceId, page, limit);

// Find by Condition
await repository.findByCondition(condition, workspaceId, page, limit);

// Find by Relationship
await repository.findByRelationship(relationship, workspaceId, page, limit);

// Search (partial match)
await repository.searchConditions(searchTerm, workspaceId, page, limit);

// Get Hereditary Conditions (high-risk only)
await repository.getHereditaryConditions(patientId, workspaceId);

// Get by Generation
await repository.getConditionsByGeneration(patientId, workspaceId);
// Returns: { firstDegree: [], secondDegree: [], thirdDegree: [] }
```

## Pattern Analysis Response

```typescript
{
  patientId: string,
  totalConditions: number,
  uniqueConditions: number,
  affectedRelatives: number,

  riskProfile: {
    highRisk: ConditionPattern[],      // Cancer, cardiac, genetic
    moderateRisk: ConditionPattern[],  // Asthma, mental health
    common: ConditionPattern[]         // High cholesterol, thyroid
  },

  generationalPattern: {
    firstDegree: ConditionSummary[],   // Parents, siblings, children
    secondDegree: ConditionSummary[],  // Grandparents, aunts, uncles
    thirdDegree: ConditionSummary[]    // Cousins, great-grandparents
  },

  recommendations: string[]             // Clinical recommendations
}
```

### ConditionPattern
```typescript
{
  condition: string,
  count: number,                  // Number of affected relatives
  relationships: string[],        // Types of relatives affected
  averageOnsetAge?: number,       // Average age of onset
  riskMultiplier: number          // Calculated risk (1.0-10.0+)
}
```

## Risk Multipliers

- **1st degree relatives**: 2.0x per relative
- **2nd degree relatives**: 1.5x per relative
- **3rd degree relatives**: 1.2x per relative
- **Early onset (< 50 years)**: +0.5x additional

## High-Risk Conditions (17)

Cancer: Breast, Ovarian, Colon, Prostate, Lung
Cardiac: Heart Disease, Stroke, Hypertension, Coronary Heart Disease
Genetic: Sickle Cell Anemia, Hemophilia, Huntington's Disease
Neurological: Alzheimer's, Parkinson's
Metabolic: Diabetes (Type 1 & 2)

## Moderate-Risk Conditions (11)

Respiratory: Asthma
Skin: Allergies, Eczema
Mental Health: Depression, Anxiety, Bipolar Disorder
Autoimmune: Osteoporosis, Arthritis, Rheumatoid Arthritis
Organ: Kidney Disease, Liver Disease

## Common Conditions (6)

High Cholesterol, Obesity, Thyroid Disorder, ADHD, Migraine, Glaucoma

## Validation Rules

1. **Patient must exist** in the workspace
2. **Age of onset ≤ current age** (if both provided)
3. **Cause of death requires isDeceased = true**
4. **Relationship must be from standardized enum**
5. **Cannot modify patientId** after creation

## Audit Actions

- `CREATE_FAMILY_CONDITION`
- `VIEW_FAMILY_CONDITION`
- `UPDATE_FAMILY_CONDITION`
- `DELETE_FAMILY_CONDITION`

All actions include:
- userId
- patientId (HIPAA requirement)
- Redacted metadata (no specific ages/identifying info)

## Query Examples

```typescript
// By patient with pagination
const result = await service.findByPatient('patient-uuid', 'workspace-uuid', 1, 20);

// Search conditions
const query = {
  searchTerm: 'cancer',
  page: 1,
  limit: 10,
  sortBy: 'condition',
  sortDirection: 'ASC'
};
await service.findAll(query, 'workspace-uuid');

// Filter by relationship
const query = {
  relationshipToPatient: RelationshipType.MOTHER,
  page: 1,
  limit: 10
};
await service.findAll(query, 'workspace-uuid');
```

## Module Integration

Import from `PatientsModule`:

```typescript
@Module({
  imports: [PatientsModule],
  // ...
})
export class YourModule {
  constructor(
    private readonly familyConditionsService: FamilyConditionsService,
    // or
    private readonly patientHistoryService: PatientHistoryService,
  ) {}
}
```

## Notes Field Structure

Since the entity lacks dedicated columns, additional fields are stored in the `notes` field as structured JSON:

```
User notes text here

[METADATA]{"snomedCode":"254837009","ageOfOnset":45,"currentAge":65,"isDeceased":false}[/METADATA]
```

The service automatically:
- Extracts metadata on read
- Merges metadata on update
- Presents fields separately in API responses

## Complete Patient History

Family conditions are included in the complete patient history:

```typescript
const history = await patientHistoryService.getCompletePatientHistory(patientId, workspaceId);

// Returns:
{
  patientId,
  allergies: [],
  allergyCount: 0,
  socialHistory: {},
  medicalHistory: [],
  medicalHistoryCount: 0,
  surgicalHistory: [],
  surgicalHistoryCount: 0,
  familyConditions: [],        // ← Included
  familyConditionCount: 0,     // ← Included
  lastUpdated: ISO string
}
```

## Performance

- **Indexes**: workspaceId, patientId (existing)
- **Pagination**: Max 100 items per page
- **Caching**: None (data accuracy critical)
- **Query optimization**: Left joins, filtered by workspace

## Security

- **Multi-tenancy**: WorkspaceId filtering on all queries
- **Soft delete**: Records marked as deleted, not removed
- **Audit trail**: All operations logged
- **Encryption**: Notes field marked as encrypted in entity

## See Also

- `FAMILY_CONDITIONS_IMPLEMENTATION.md` - Full implementation details
- `src/domains/patients/services/family-conditions.service.ts` - Service source
- `src/domains/patients/repositories/family-condition.repository.ts` - Repository source
