# Audit Domain - Complete Documentation

## Overview

The Audit Domain provides comprehensive HIPAA-compliant audit logging for the multi-tenant EMR and AI backend system. It tracks all system actions, patient data access, clinical note modifications, and complex operations with complete traceability and PHI protection.

## Architecture

### Layer Structure

```
audit/
├── entities/                 # TypeORM entities
│   ├── audit-log.entity.ts          # General audit trail
│   ├── audit-context.entity.ts      # Complex operation tracking
│   └── note-audit-log.entity.ts     # Clinical note auditing
├── dto/                      # Data Transfer Objects
│   ├── create-audit-log.dto.ts
│   ├── query-audit-logs.dto.ts
│   ├── audit-log-response.dto.ts
│   ├── paginated-audit-logs-response.dto.ts
│   ├── create-audit-context.dto.ts
│   ├── audit-context-response.dto.ts
│   ├── create-note-audit-log.dto.ts
│   ├── note-audit-log-response.dto.ts
│   └── index.ts
├── repositories/             # Data access layer
│   ├── audit-log.repository.ts
│   ├── audit-context.repository.ts
│   ├── note-audit-log.repository.ts
│   └── index.ts
├── services/                 # Business logic
│   ├── audit-log.service.ts
│   ├── audit-context.service.ts
│   ├── note-audit.service.ts
│   └── index.ts
├── audit.module.ts          # NestJS module
└── index.ts                 # Public API
```

## Entities

### AuditLog Entity

**Purpose**: Immutable audit trail for all system actions with HIPAA compliance.

**Key Features**:
- Multi-tenancy support (workspaceId)
- Patient access tracking (patientId, justification)
- Action outcome tracking (SUCCESS/FAILURE)
- PHI redaction in previousState/newState
- Comprehensive indexing for fast queries

**Fields**:
- `id` (UUID): Primary key
- `workspaceId` (string): Workspace identifier
- `userId` (string): User who performed the action
- `action` (string): Action performed (e.g., "POST /api/patients")
- `eventType` (enum): Type of event (CREATE, READ, UPDATE, DELETE, etc.)
- `outcome` (enum): Result (SUCCESS, FAILURE)
- `resourceType` (string): Entity type affected
- `resourceId` (string): Entity ID affected
- `patientId` (string, optional): Patient ID for HIPAA tracking
- `justification` (text, optional): Access justification
- `previousState` (JSON, optional): State before action
- `newState` (JSON, optional): State after action
- `metadata` (JSON, optional): IP, user agent, etc.
- `timestamp` (timestamp): Action timestamp
- Inherits: `createdAt`, `updatedAt`, `deletedAt`, `isDeleted`, `isActive` from BaseEntity

**Indexes**:
- workspaceId, userId, patientId, resourceType, resourceId, eventType, outcome, timestamp
- Composite index: (workspaceId, userId, eventType, timestamp)

### AuditContext Entity

**Purpose**: Track contextual information for complex transactions and multi-step operations.

**Key Features**:
- Transaction tracking with status
- State capture at different points
- Failure tracking with reasons
- Support for rollback operations

**Fields**:
- `id` (UUID): Primary key
- `workspaceId` (string): Workspace identifier
- `contextId` (UUID): Unique context identifier
- `actionType` (string): Type of action
- `status` (enum): PENDING, COMPLETED, FAILED, REVERSED
- `userId` (string): User who initiated
- `entityType` (string): Entity type
- `entityId` (string): Entity ID
- `previousState` (JSON): State before operation
- `newState` (JSON): State after operation
- `metadata` (JSON): Operation details
- `ipAddress` (string): User IP
- `userAgent` (string): Client user agent
- `reason` (text): Justification
- `failureReason` (text): Failure reason if applicable
- `completedAt` (timestamp): Completion timestamp
- Inherits: `createdAt`, `updatedAt`, `deletedAt`, `isDeleted`, `isActive` from BaseEntity

**Methods**:
- `captureState(state)`: Capture entity state
- `markCompleted()`: Mark as completed
- `markFailed(reason)`: Mark as failed
- `markReversed()`: Mark as reversed (rollback)

**Indexes**:
- workspaceId, contextId, userId, entityType, entityId, status, createdAt
- Composite index: (workspaceId, userId, status, createdAt)

### NoteAuditLog Entity

**Purpose**: Specialized audit logging for clinical notes and care documentation.

**Key Features**:
- Tracks all note modifications
- Records AI interactions
- Captures sharing and permission changes
- Field-level change tracking

**Fields**:
- `id` (UUID): Primary key
- `workspaceId` (string): Workspace identifier
- `noteId` (UUID): Note being audited
- `userId` (string): User who performed action
- `actionType` (enum): CREATE, UPDATE, DELETE, PUBLISH, APPROVE, SHARE, AI_GENERATE, etc.
- `changedFields` (JSON array): List of changed fields
- `previousValues` (JSON): Previous field values
- `newValues` (JSON): New field values
- `metadata` (JSON): Additional metadata
- `ipAddress` (string): User IP
- `userAgent` (string): Client user agent
- `comment` (text): User comment/justification
- `patientId` (string): Associated patient
- `aiProvider` (string): AI provider for AI actions
- `sharedWith` (string): User/role shared with
- `oldPermission` (string): Previous permission level
- `newPermission` (string): New permission level
- Inherits: `createdAt`, `updatedAt`, `deletedAt`, `isDeleted`, `isActive` from BaseEntity

**Indexes**:
- workspaceId, noteId, userId, actionType, createdAt
- Composite index: (workspaceId, noteId, actionType, createdAt)

## Services

### AuditLogService

**Purpose**: General audit logging with PHI redaction and HIPAA compliance.

**Key Methods**:

```typescript
// Create audit log with PHI redaction
async log(dto: CreateAuditLogDto, workspaceId: string): Promise<AuditLog>

// Find all audit logs with filtering
async findAll(query: QueryAuditLogsDto, workspaceId: string): Promise<{ data: AuditLog[]; meta: any }>

// Find audit logs by resource
async findByResource(resourceType: string, resourceId: string, workspaceId: string): Promise<AuditLog[]>

// Find audit logs by patient (HIPAA)
async findByPatient(patientId: string, workspaceId: string): Promise<AuditLog[]>

// Find audit logs by user
async findByUser(userId: string, workspaceId: string, dateRange?: { startDate?: Date; endDate?: Date }): Promise<AuditLog[]>

// Get statistics by event type
async getStatistics(workspaceId: string, startDate: Date, endDate: Date): Promise<Record<string, number>>

// Find suspicious activity
async findSuspiciousActivity(workspaceId: string): Promise<AuditLog[]>
```

**PHI Redaction**:
- Recursive object traversal
- Pattern-based field detection
- Replaces sensitive values with `[REDACTED]`
- Configurable patterns in audit.config.ts

**HIPAA Compliance**:
- Immutable logs (no updates)
- Patient access tracking
- Justification support
- Retention policy support

### AuditContextService

**Purpose**: Track complex operations and transactions.

**Key Methods**:

```typescript
// Create audit context
async createContext(dto: CreateAuditContextDto, workspaceId: string): Promise<AuditContext>

// Capture entity state
async captureState(contextId: string, state: Record<string, any>, workspaceId: string): Promise<AuditContext>

// Mark as completed
async markCompleted(contextId: string, workspaceId: string): Promise<AuditContext>

// Mark as failed
async markFailed(contextId: string, reason: string, workspaceId: string): Promise<AuditContext>

// Find by entity
async findByEntity(entityType: string, entityId: string, workspaceId: string): Promise<AuditContext[]>

// Find by status
async findByStatus(status: AuditContextStatus, workspaceId: string): Promise<AuditContext[]>

// Find pending contexts
async findPendingContexts(workspaceId: string): Promise<AuditContext[]>

// Find by user
async findByUser(userId: string, workspaceId: string): Promise<AuditContext[]>
```

**Use Cases**:
- Bulk operations
- Import/Export operations
- Complex workflows
- Transaction rollback tracking

### NoteAuditService

**Purpose**: Specialized audit logging for clinical notes.

**Key Methods**:

```typescript
// Log note action
async logNoteAction(noteId: string, userId: string, actionType: NoteAuditActionType, changedFields: string[] | undefined, metadata: Record<string, any>, workspaceId: string): Promise<NoteAuditLog>

// Get note audit trail
async getNoteAuditTrail(noteId: string, workspaceId: string, page?: number, limit?: number): Promise<{ data: NoteAuditLog[]; meta: any }>

// Get user note activity
async getUserNoteActivity(userId: string, workspaceId: string, dateRange?: { startDate?: Date; endDate?: Date }): Promise<NoteAuditLog[]>

// Get by action type
async getByActionType(actionType: NoteAuditActionType, workspaceId: string, limit?: number): Promise<NoteAuditLog[]>

// Get by patient
async getByPatient(patientId: string, workspaceId: string): Promise<NoteAuditLog[]>

// Get AI-related logs
async getAIRelatedLogs(workspaceId: string, dateRange?: { startDate?: Date; endDate?: Date }): Promise<NoteAuditLog[]>

// Convenience methods
async logNoteCreation(noteId: string, userId: string, metadata: Record<string, any>, workspaceId: string): Promise<NoteAuditLog>
async logNoteUpdate(noteId: string, userId: string, changedFields: string[], metadata: Record<string, any>, workspaceId: string): Promise<NoteAuditLog>
async logNoteSharing(noteId: string, userId: string, sharedWith: string, metadata: Record<string, any>, workspaceId: string): Promise<NoteAuditLog>
async logAIGeneration(noteId: string, userId: string, aiProvider: string, metadata: Record<string, any>, workspaceId: string): Promise<NoteAuditLog>
```

## Configuration

### Environment Variables

Add to `.env`:

```env
# Audit Configuration
AUDIT_RETENTION_DAYS=730                    # 2 years default (HIPAA: 6 years recommended)
AUDIT_MAX_CAPACITY_BYTES=10737418240        # 10GB default
AUDIT_ANOMALY_DETECTION=true                # Enable anomaly detection
AUDIT_HIPAA_MODE=true                       # HIPAA compliance mode (default: true)
AUDIT_BATCH_SIZE=100                        # Batch size for high-volume operations
AUDIT_ENABLE_STREAMING=false                # Real-time streaming to SIEM
AUDIT_ENABLE_COMPRESSION=false              # Compress old logs
AUDIT_SUSPICIOUS_ACTIVITY_THRESHOLD=5       # Failures before alerting
AUDIT_SUSPICIOUS_ACTIVITY_WINDOW=60         # Time window in minutes
```

### Configuration File

Located at: `src/config/audit.config.ts`

**PHI Patterns** (default):
- ssn, social security
- health, medical, diagnosis, prescription, medication
- password, token, secret, api key
- credit card, cvv, account number, routing number
- national id, passport, driver license

## Usage Examples

### 1. Basic Audit Logging

```typescript
import { AuditLogService } from '@domains/audit';
import { AuditEventType, AuditOutcome } from '@common/enums';

// Inject service
constructor(private auditLogService: AuditLogService) {}

// Log a patient create action
async createPatient(data: any, userId: string, workspaceId: string) {
  try {
    const patient = await this.patientRepository.save(data);

    // Log success
    await this.auditLogService.log({
      userId,
      action: 'CREATE PATIENT',
      eventType: AuditEventType.CREATE,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'Patient',
      resourceId: patient.id,
      patientId: patient.id,
      justification: 'New patient registration',
      newState: patient,
      metadata: {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    }, workspaceId);

    return patient;
  } catch (error) {
    // Log failure
    await this.auditLogService.log({
      userId,
      action: 'CREATE PATIENT',
      eventType: AuditEventType.CREATE,
      outcome: AuditOutcome.FAILURE,
      resourceType: 'Patient',
      metadata: {
        error: error.message,
        ipAddress: req.ip,
      },
    }, workspaceId);

    throw error;
  }
}
```

### 2. Patient Access Audit (HIPAA)

```typescript
// Log patient data access
async getPatient(patientId: string, userId: string, workspaceId: string) {
  const patient = await this.patientRepository.findOne(patientId);

  // HIPAA: Log every patient data access
  await this.auditLogService.log({
    userId,
    action: 'VIEW PATIENT',
    eventType: AuditEventType.READ,
    outcome: AuditOutcome.SUCCESS,
    resourceType: 'Patient',
    resourceId: patientId,
    patientId,
    justification: 'Medical review for appointment',
    metadata: {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    },
  }, workspaceId);

  return patient;
}
```

### 3. Complex Operation Tracking

```typescript
import { AuditContextService } from '@domains/audit';
import { v4 as uuidv4 } from 'uuid';

// Track a bulk import operation
async bulkImportPatients(patients: any[], userId: string, workspaceId: string) {
  const contextId = uuidv4();

  // Create audit context
  await this.auditContextService.createContext({
    contextId,
    actionType: 'BULK_IMPORT_PATIENTS',
    userId,
    entityType: 'Patient',
    entityId: 'multiple',
    metadata: {
      totalCount: patients.length,
    },
  }, workspaceId);

  try {
    // Capture initial state
    await this.auditContextService.captureState(contextId, {
      status: 'processing',
      processed: 0,
    }, workspaceId);

    // Process patients
    for (const patient of patients) {
      await this.patientRepository.save(patient);
    }

    // Capture final state
    await this.auditContextService.captureState(contextId, {
      status: 'completed',
      processed: patients.length,
    }, workspaceId);

    // Mark as completed
    await this.auditContextService.markCompleted(contextId, workspaceId);

  } catch (error) {
    // Mark as failed
    await this.auditContextService.markFailed(
      contextId,
      error.message,
      workspaceId
    );
    throw error;
  }
}
```

### 4. Note Audit Logging

```typescript
import { NoteAuditService } from '@domains/audit';
import { NoteAuditActionType } from '@common/enums';

// Log note creation
async createNote(noteData: any, userId: string, workspaceId: string) {
  const note = await this.noteRepository.save(noteData);

  await this.noteAuditService.logNoteCreation(
    note.id,
    userId,
    {
      patientId: note.patientId,
      noteType: note.type,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    },
    workspaceId
  );

  return note;
}

// Log note update with field tracking
async updateNote(noteId: string, updates: any, userId: string, workspaceId: string) {
  const oldNote = await this.noteRepository.findOne(noteId);
  const updatedNote = await this.noteRepository.save({ ...oldNote, ...updates });

  // Track changed fields
  const changedFields = Object.keys(updates);

  await this.noteAuditService.logNoteUpdate(
    noteId,
    userId,
    changedFields,
    {
      previousValues: changedFields.reduce((acc, field) => ({
        ...acc,
        [field]: oldNote[field]
      }), {}),
      newValues: updates,
      patientId: oldNote.patientId,
      ipAddress: req.ip,
    },
    workspaceId
  );

  return updatedNote;
}

// Log AI note generation
async generateNoteWithAI(noteId: string, prompt: string, userId: string, workspaceId: string) {
  const aiContent = await this.aiService.generateNote(prompt);

  await this.noteAuditService.logAIGeneration(
    noteId,
    userId,
    'openai',
    {
      prompt,
      model: 'gpt-4',
      tokenCount: aiContent.usage.total_tokens,
    },
    workspaceId
  );

  return aiContent;
}
```

### 5. Query Audit Logs

```typescript
// Get patient access history
const patientAuditLogs = await this.auditLogService.findByPatient(
  patientId,
  workspaceId
);

// Get user activity
const userActivity = await this.auditLogService.findByUser(
  userId,
  workspaceId,
  {
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-12-31'),
  }
);

// Get resource audit trail
const appointmentLogs = await this.auditLogService.findByResource(
  'Appointment',
  appointmentId,
  workspaceId
);

// Get audit statistics
const stats = await this.auditLogService.getStatistics(
  workspaceId,
  new Date('2024-01-01'),
  new Date('2024-12-31')
);
// Returns: { CREATE: 150, READ: 500, UPDATE: 75, DELETE: 10 }

// Find suspicious activity
const suspicious = await this.auditLogService.findSuspiciousActivity(workspaceId);
```

## HIPAA Compliance Features

### 1. Patient Access Tracking
- Every patient data access is logged
- `patientId` field tracks which patient's data was accessed
- `justification` field for access reason

### 2. Immutable Audit Logs
- No updates or deletes allowed
- All logs are append-only
- Soft deletes disabled for audit logs

### 3. PHI Redaction
- Automatic redaction of sensitive fields
- Pattern-based detection
- Configurable patterns
- Applied before persistence

### 4. Retention Policy
- Default: 730 days (2 years)
- HIPAA requirement: 6 years minimum
- Configurable via environment variable
- Cleanup job support

### 5. Outcome Tracking
- SUCCESS/FAILURE outcomes
- Failed access attempts logged
- Anomaly detection for suspicious patterns

### 6. Complete Audit Trail
- Who: userId
- What: action, resourceType, resourceId
- When: timestamp
- Where: ipAddress
- Why: justification
- How: metadata (user agent, etc.)

## Performance Considerations

### Indexing Strategy
- All frequently queried fields are indexed
- Composite indexes for common query patterns
- workspaceId always indexed for multi-tenancy

### Query Patterns
- Use pagination for large result sets
- Leverage indexed fields in WHERE clauses
- Use date ranges to limit query scope

### Batch Operations
- Support for bulk logging (configurable batch size)
- Async logging for non-critical operations
- Consider queuing for high-volume scenarios

## Best Practices

### 1. Always Log User Actions
```typescript
// Good: Log all CRUD operations
await this.auditLogService.log({
  userId,
  action: 'UPDATE PATIENT',
  eventType: AuditEventType.UPDATE,
  outcome: AuditOutcome.SUCCESS,
  resourceType: 'Patient',
  resourceId: patientId,
  previousState: oldPatient,
  newState: updatedPatient,
}, workspaceId);
```

### 2. Provide Justification for PHI Access
```typescript
// Good: Always provide justification when accessing patient data
await this.auditLogService.log({
  userId,
  action: 'VIEW PATIENT',
  eventType: AuditEventType.READ,
  patientId,
  justification: 'Pre-appointment review',
}, workspaceId);
```

### 3. Track Failed Operations
```typescript
// Good: Log failures for security monitoring
catch (error) {
  await this.auditLogService.log({
    userId,
    action: 'DELETE PATIENT',
    eventType: AuditEventType.DELETE,
    outcome: AuditOutcome.FAILURE,
    resourceId: patientId,
    metadata: { error: error.message },
  }, workspaceId);
}
```

### 4. Use Audit Contexts for Complex Operations
```typescript
// Good: Track multi-step operations
const contextId = uuidv4();
await this.auditContextService.createContext({
  contextId,
  actionType: 'DATA_MIGRATION',
  userId,
  entityType: 'Patient',
  entityId: 'multiple',
}, workspaceId);

// ... perform operations ...

await this.auditContextService.markCompleted(contextId, workspaceId);
```

### 5. Capture Metadata
```typescript
// Good: Include context in metadata
metadata: {
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
  sessionId: req.session.id,
  apiVersion: 'v1',
}
```

## Integration with Other Domains

### Example: Patients Domain Integration

```typescript
// In patients.service.ts
import { AuditLogService } from '@domains/audit';
import { AuditEventType, AuditOutcome } from '@common/enums';

@Injectable()
export class PatientsService {
  constructor(
    private patientRepository: PatientRepository,
    private auditLogService: AuditLogService,
  ) {}

  async create(dto: CreatePatientDto, userId: string, workspaceId: string) {
    const patient = await this.patientRepository.save(dto);

    // Log creation
    await this.auditLogService.log({
      userId,
      action: 'CREATE_PATIENT',
      eventType: AuditEventType.CREATE,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'Patient',
      resourceId: patient.id,
      patientId: patient.id,
      newState: patient,
    }, workspaceId);

    return patient;
  }
}
```

## Monitoring and Alerts

### Suspicious Activity Detection

The audit system includes built-in anomaly detection:

```typescript
// Run periodically (e.g., via cron job)
const suspicious = await this.auditLogService.findSuspiciousActivity(workspaceId);

if (suspicious.length > 0) {
  // Alert security team
  await this.notificationService.alertSecurity({
    type: 'SUSPICIOUS_ACTIVITY',
    count: suspicious.length,
    workspaceId,
    logs: suspicious,
  });
}
```

### Metrics to Monitor
- Failed login attempts per user
- Multiple failed data access attempts
- Unusual access patterns (time, volume)
- Permission elevation attempts
- Bulk operations
- PHI access without justification

## Migration Guide

### Database Migration

Run the TypeORM migration to create audit tables:

```bash
npm run migration:generate -- src/migrations/CreateAuditTables
npm run migration:run
```

### Module Registration

Add to `app.module.ts`:

```typescript
import { AuditModule } from './domains/audit/audit.module';
import { auditConfig } from './config';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [auditConfig, ...otherConfigs],
    }),
    AuditModule,
    // ... other modules
  ],
})
export class AppModule {}
```

## Testing

### Unit Test Example

```typescript
describe('AuditLogService', () => {
  let service: AuditLogService;
  let repository: AuditLogRepository;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AuditLogService,
        {
          provide: AuditLogRepository,
          useValue: {
            save: jest.fn(),
            findWithFilters: jest.fn(),
          },
        },
        {
          provide: LoggerService,
          useValue: { log: jest.fn(), error: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(AuditLogService);
    repository = module.get(AuditLogRepository);
  });

  it('should create audit log with PHI redaction', async () => {
    const dto = {
      userId: 'user-123',
      action: 'CREATE',
      eventType: AuditEventType.CREATE,
      outcome: AuditOutcome.SUCCESS,
      newState: {
        name: 'John Doe',
        ssn: '123-45-6789', // Should be redacted
      },
    };

    await service.log(dto, 'workspace-123');

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        newState: {
          name: 'John Doe',
          ssn: '[REDACTED]',
        },
      })
    );
  });
});
```

## Troubleshooting

### Issue: Slow Audit Log Queries

**Solution**: Ensure indexes are created and use pagination:

```typescript
// Good: Use pagination
const result = await auditLogService.findAll({
  page: 1,
  limit: 20,
  startDate: recentDate, // Limit time range
}, workspaceId);

// Bad: Query all logs without pagination
const allLogs = await auditLogService.findAll({}, workspaceId);
```

### Issue: High Storage Usage

**Solution**: Implement retention policy and compression:

1. Enable compression: `AUDIT_ENABLE_COMPRESSION=true`
2. Reduce retention: `AUDIT_RETENTION_DAYS=180`
3. Archive old logs to cold storage

### Issue: PHI Not Being Redacted

**Solution**: Check configuration and patterns:

1. Verify `AUDIT_HIPAA_MODE=true`
2. Add custom patterns to audit.config.ts
3. Test PHI redaction in development

## Security Considerations

1. **Access Control**: Audit logs should only be accessible to authorized personnel
2. **Immutability**: Never allow updates or deletes of audit logs
3. **Encryption**: Consider encrypting audit logs at rest
4. **Monitoring**: Set up alerts for suspicious patterns
5. **Backup**: Regular backups of audit logs for compliance

## Support and Maintenance

### Regular Maintenance Tasks

1. **Monthly**: Review suspicious activity logs
2. **Quarterly**: Audit log storage review and cleanup
3. **Yearly**: HIPAA compliance audit review
4. **Continuous**: Monitor performance metrics

### Retention Policy Enforcement

Create a cron job to enforce retention policy:

```typescript
@Cron('0 0 * * *') // Run daily at midnight
async cleanupOldLogs() {
  const retentionDate = new Date();
  retentionDate.setDate(retentionDate.getDate() - this.retentionDays);

  // Archive logs older than retention period
  await this.archiveOldLogs(retentionDate);
}
```

## Conclusion

The Audit Domain provides enterprise-grade audit logging with HIPAA compliance, PHI protection, and comprehensive tracking for all system operations. It's designed to scale with your application while maintaining security and compliance requirements.

For questions or support, please refer to the main project documentation or contact the development team.
