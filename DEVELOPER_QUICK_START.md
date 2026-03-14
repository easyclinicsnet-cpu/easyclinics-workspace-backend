# Developer Quick Start Guide

## 🚀 Getting Started

### Build & Run
```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run migrations
npm run migration:generate -- -n InitialMigration
npm run migration:run

# Start development server
npm run start:dev

# Start production server
npm run start:prod
```

---

## 📦 Domain Services Available

### **Patients Domain**
```typescript
import {
  PatientsService,        // Patient CRUD with in-memory indexing
  VitalsService,          // Vital signs management
  AllergiesService,       // Allergy tracking
  SocialHistoryService,   // Social history & risk
  MedicalHistoryService,  // Past medical conditions
  SurgicalHistoryService, // Surgical procedures
  FamilyConditionsService, // Family history & genetic risk
  PatientHistoryService   // CONSOLIDATED FACADE - Use this for all history!
} from './domains/patients/services';
```

### **Appointments Domain**
```typescript
import { AppointmentsService } from './domains/appointments/services';
```

### **Audit Domain**
```typescript
import {
  AuditLogService,        // General audit logging
  AuditContextService,    // Transaction context
  NoteAuditService        // Clinical notes audit
} from './domains/audit/services';
```

---

## 🎯 Most Used: PatientHistoryService

**Why use the facade?**
- Single service for all patient history
- Composite operations (getCompletePatientHistory, getPatientRiskProfile)
- Parallel data fetching
- Simplified API

### Basic Usage
```typescript
constructor(
  private readonly patientHistoryService: PatientHistoryService,
) {}

// Get everything at once
async getPatientRecord(patientId: string, workspaceId: string) {
  return this.patientHistoryService.getCompletePatientHistory(
    patientId,
    workspaceId
  );
}

// Get risk assessment
async assessPatient(patientId: string, workspaceId: string) {
  return this.patientHistoryService.getPatientRiskProfile(
    patientId,
    workspaceId
  );
}

// Individual operations
async addAllergy(dto: CreateAllergyDto, userId: string, workspaceId: string) {
  return this.patientHistoryService.createAllergy(dto, userId, workspaceId);
}

async addFamilyHistory(dto: CreateFamilyConditionDto, userId: string, workspaceId: string) {
  return this.patientHistoryService.createFamilyCondition(dto, userId, workspaceId);
}
```

---

## 📋 Common Operations

### **Create Patient with Insurance**
```typescript
const dto: CreatePatientDto = {
  workspaceId: 'workspace-uuid',
  firstName: 'John',
  lastName: 'Doe',
  gender: Gender.MALE,
  birthDate: '1990-01-15',
  phoneNumber: '+1234567890',
  email: 'john@example.com',
  updatePatientInsurance: true,
  insuranceProviderId: 'provider-uuid',
  schemeId: 'scheme-uuid',
  insuranceMembershipNumber: 'MEM123456',
  memberType: 'PRINCIPAL',
};

const patient = await patientsService.create(dto, userId, workspaceId);
```

### **Search Patients (In-Memory Index)**
```typescript
const results = await patientsService.findAll(
  {
    search: 'john doe',
    page: 1,
    limit: 10,
    isActive: true,
  },
  workspaceId
);
// Uses O(1) in-memory index for blazing fast search
```

### **Add Vitals**
```typescript
const vitalDto: CreateVitalDto = {
  patientId: 'patient-uuid',
  appointmentId: 'appointment-uuid', // optional
  temperature: '37.5',
  bloodPressure: '120/80',
  heartRate: '75',
  saturation: '98',
  gcs: '15',
  bloodGlucose: '95',
  height: '175',
  weight: '70',
};

const vital = await vitalsService.create(vitalDto, userId, workspaceId);
console.log(`BMI: ${vital.bmi}`); // Auto-calculated
```

### **Track Allergies**
```typescript
const allergyDto: CreateAllergyDto = {
  patientId: 'patient-uuid',
  substance: 'Penicillin',
  reaction: 'Anaphylaxis',
  severity: Severity.LIFE_THREATENING,
  onsetDate: '2020-05-15',
  snomedCode: '91936005', // Optional SNOMED CT code
};

const allergy = await allergiesService.create(allergyDto, userId, workspaceId);
```

### **Record Medical History**
```typescript
const medicalDto: CreateMedicalHistoryDto = {
  patientId: 'patient-uuid',
  condition: 'Type 2 Diabetes Mellitus',
  dateOfDiagnosis: '2018-03-20',
  status: 'ACTIVE',
  icd10Code: 'E11', // Optional ICD-10 code
  snomedCode: '44054006', // Optional SNOMED CT code
  notes: 'Well controlled with metformin',
};

const history = await medicalHistoryService.create(medicalDto, userId, workspaceId);
```

### **Record Surgical History**
```typescript
const surgicalDto: CreateSurgicalHistoryDto = {
  patientId: 'patient-uuid',
  procedure: 'Appendectomy',
  dateOfSurgery: '2015-06-10',
  complications: 'None',
  cptCode: '44950', // Optional CPT code
  icd10pcsCode: '0DTJ4ZZ', // Optional ICD-10-PCS code
  notes: 'Laparoscopic approach',
};

const surgery = await surgicalHistoryService.create(surgicalDto, userId, workspaceId);
```

### **Track Family Conditions**
```typescript
const familyDto: CreateFamilyConditionDto = {
  patientId: 'patient-uuid',
  condition: 'Breast Cancer',
  relationshipToPatient: 'Mother',
  ageOfOnset: 45,
  currentAge: 70,
  isDeceased: false,
  snomedCode: '254837009', // Optional SNOMED CT code
};

const familyCondition = await familyConditionsService.create(familyDto, userId, workspaceId);

// Get genetic risk analysis
const analysis = await familyConditionsService.getPatternAnalysis(
  patientId,
  workspaceId
);
console.log(analysis.riskProfile.highRisk); // Array of high-risk conditions
console.log(analysis.recommendations); // Clinical recommendations
```

### **Complete Patient History**
```typescript
const history = await patientHistoryService.getCompletePatientHistory(
  patientId,
  workspaceId
);

console.log(`Allergies: ${history.allergyCount}`);
console.log(`Medical Conditions: ${history.medicalHistoryCount}`);
console.log(`Surgeries: ${history.surgicalHistoryCount}`);
console.log(`Family Conditions: ${history.familyConditionCount}`);
```

### **Patient Risk Profile**
```typescript
const riskProfile = await patientHistoryService.getPatientRiskProfile(
  patientId,
  workspaceId
);

console.log(`Overall Risk: ${riskProfile.overallRisk}`); // CRITICAL, HIGH, MODERATE, LOW, MINIMAL
console.log(`Severe Allergies: ${riskProfile.factors.severeAllergies}`);
console.log(`Social Risk: ${riskProfile.factors.socialRisk}`);
console.log(`Chronic Conditions: ${riskProfile.factors.chronicConditions}`);
console.log(`Recommendations:`, riskProfile.recommendations);
```

---

## 🔐 HIPAA Compliance

### **Automatic Audit Logging**
All services automatically log to audit trail:
- Patient operations (CREATE, UPDATE, VIEW, DELETE)
- Medical records (CREATE, UPDATE, VIEW, DELETE)
- All operations include patientId for HIPAA compliance

### **Encrypted Fields**
Automatically encrypted (via EncryptedRepository or service layer):
- Patient: firstName, lastName, DOB, phone, email, address, SSN
- Vitals: All measurements
- Allergies: substance, reaction
- Medical/Surgical: conditions, procedures, complications
- Family: conditions, notes

### **Multi-Tenancy**
All operations require `workspaceId`:
- Enforced at service layer
- Filtered at repository layer
- Validated by TenantSchemaGuard (when using API)

---

## 📊 Performance Tips

### **Use In-Memory Index for Patient Search**
```typescript
// FAST: O(1) lookup via in-memory index
const results = await patientsService.findAll(
  { search: 'john', page: 1, limit: 10 },
  workspaceId
);

// Specific searches
const byPhone = await patientsService.findByPhone('+1234567890', 1, 10);
const byFileNumber = await patientsService.findByFileNumber('FN001', 1, 10);
```

### **Encrypted Search with Caching**
```typescript
// First call: decrypts and caches (slower)
const result1 = await patientRepository.searchEncryptedFields('john', 1, 10);

// Second call within 5 minutes: cache hit (fast)
const result2 = await patientRepository.searchEncryptedFields('john', 1, 10);
```

### **Batch Operations**
```typescript
// Efficient bulk update
const updates = patients.map(p => ({ ...p, isActive: false }));
await patientRepository.bulkSave(updates);
```

---

## 🧪 Testing Examples

### **Unit Test (Service)**
```typescript
describe('AllergiesService', () => {
  let service: AllergiesService;
  let repository: MockType<AllergyRepository>;
  let patientRepository: MockType<PatientRepository>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AllergiesService,
        { provide: AllergyRepository, useFactory: mockRepository },
        { provide: PatientRepository, useFactory: mockRepository },
        { provide: LoggerService, useValue: mockLogger },
        { provide: AuditLogService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<AllergiesService>(AllergiesService);
  });

  it('should create allergy with audit log', async () => {
    const dto: CreateAllergyDto = {
      patientId: 'patient-uuid',
      substance: 'Penicillin',
      reaction: 'Rash',
      severity: Severity.MODERATE,
    };

    repository.findOne.mockResolvedValue(null); // No duplicate
    patientRepository.findById.mockResolvedValue(patient);
    repository.save.mockResolvedValue(allergy);

    const result = await service.create(dto, 'user-uuid', 'workspace-uuid');

    expect(result).toBeDefined();
    expect(repository.save).toHaveBeenCalled();
    expect(auditLogService.log).toHaveBeenCalled();
  });
});
```

### **Integration Test**
```typescript
describe('Patient History Integration', () => {
  it('should return complete patient history', async () => {
    const history = await patientHistoryService.getCompletePatientHistory(
      patientId,
      workspaceId
    );

    expect(history.allergies).toBeInstanceOf(Array);
    expect(history.medicalHistory).toBeInstanceOf(Array);
    expect(history.surgicalHistory).toBeInstanceOf(Array);
    expect(history.familyConditions).toBeInstanceOf(Array);
    expect(history.socialHistory).toBeDefined();
  });
});
```

---

## 🔧 Configuration

### **Environment Variables**
```env
# Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=your_password
DATABASE_NAME=emr_db

# Encryption
ENCRYPTION_KEY=your-32-byte-encryption-key
ENCRYPTION_ROTATION_DAYS=90

# Audit
AUDIT_RETENTION_DAYS=730
AUDIT_HIPAA_MODE=true

# JWT
JWT_SECRET=your-jwt-secret
JWT_EXPIRATION=1h
```

### **Module Imports**
```typescript
import { Module } from '@nestjs/common';
import { PatientsModule } from './domains/patients/patients.module';
import { AppointmentsModule } from './domains/appointments/appointments.module';
import { AuditModule } from './domains/audit/audit.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, auditConfig, databaseConfig, encryptionConfig, jwtConfig],
    }),
    PatientsModule,    // All 8 services available
    AppointmentsModule,
    AuditModule,
  ],
})
export class AppModule {}
```

---

## 📖 Standards Reference

### **Coding Systems**
- **ICD-10-CM**: Diagnosis codes (US) - https://www.cdc.gov/nchs/icd/icd10cm.htm
- **ICD-11**: WHO diagnosis codes - https://icd.who.int/en
- **CPT**: Procedure codes - https://www.ama-assn.org/practice-management/cpt
- **SNOMED CT**: Clinical terms - https://www.snomed.org/
- **LOINC**: Lab observations - https://loinc.org/

### **HL7 FHIR Resources**
- Patient: https://www.hl7.org/fhir/patient.html
- AllergyIntolerance: https://www.hl7.org/fhir/allergyintolerance.html
- Observation: https://www.hl7.org/fhir/observation-vitalsigns.html
- Condition: https://www.hl7.org/fhir/condition.html
- Procedure: https://www.hl7.org/fhir/procedure.html
- FamilyMemberHistory: https://www.hl7.org/fhir/familymemberhistory.html

---

## 🆘 Common Issues

### **Build Errors**
```bash
# Clear and rebuild
rm -rf dist node_modules
npm install
npm run build
```

### **TypeORM Errors**
```bash
# Regenerate migrations
npm run migration:revert
npm run migration:generate -- -n FixMigration
npm run migration:run
```

### **Encryption Errors**
- Ensure ENCRYPTION_KEY is exactly 32 bytes
- Check encryption.config.ts for proper configuration

### **Audit Not Logging**
- Verify AuditModule is imported in app.module.ts
- Check audit.config.ts for HIPAA mode settings
- Ensure workspaceId is provided in all service calls

---

## 📞 Support

### **Documentation**
- `FINAL_IMPLEMENTATION_SUMMARY.md` - Complete overview
- `PATIENT_HISTORY_SERVICES_IMPLEMENTATION.md` - Medical history details
- `AUDIT_DOMAIN_COMPLETE.md` - Audit system details
- `APPOINTMENTS_MIGRATION_COMPLETE.md` - Appointments details

### **Key Files**
- Service interfaces: `src/domains/*/services/*.service.ts`
- DTOs: `src/domains/*/dto/`
- Entities: `src/domains/*/entities/`
- Configs: `src/config/`

---

**Quick Start Version:** 1.0
**Last Updated:** February 16, 2026
