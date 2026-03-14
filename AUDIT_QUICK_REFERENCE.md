# Audit Integration Quick Reference Guide

## Overview

The audit domain is now integrated into patients and appointments domains for HIPAA compliance. All CRUD operations and access patterns are automatically logged.

## Quick Start

### 1. Import the Audit Enums

```typescript
import { AuditEventType, AuditOutcome } from '../../../common/enums';
```

### 2. Inject the Audit Service

```typescript
constructor(
  // ... other dependencies
  private readonly auditLogService: AuditLogService,
) {}
```

### 3. Log an Audit Event

```typescript
try {
  await this.auditLogService.log({
    userId: 'user-id',
    action: 'ACTION_NAME',
    eventType: AuditEventType.CREATE,
    outcome: AuditOutcome.SUCCESS,
    resourceType: 'ResourceType',
    resourceId: 'resource-id',
    patientId: 'patient-id', // Optional, for HIPAA tracking
    justification: 'Reason for access', // Optional
    metadata: { key: 'value' }, // Optional
  }, workspaceId);
} catch (auditError) {
  this.logger.error('Failed to create audit log', auditError.stack);
}
```

## Audit Event Types

```typescript
enum AuditEventType {
  CREATE = 'CREATE',     // Resource creation
  READ = 'READ',         // Resource access/view
  UPDATE = 'UPDATE',     // Resource modification
  DELETE = 'DELETE',     // Resource deletion
  EXPORT = 'EXPORT',     // Data export
  LOGIN = 'LOGIN',       // User login
  LOGOUT = 'LOGOUT',     // User logout
  ACCESS_DENIED = 'ACCESS_DENIED', // Access denied
  OTHER = 'OTHER',       // Other actions
}
```

## Audit Outcomes

```typescript
enum AuditOutcome {
  SUCCESS = 'SUCCESS',   // Operation succeeded
  FAILURE = 'FAILURE',   // Operation failed
}
```

## Standard Audit Actions

### Patients Domain

| Action | Event Type | When to Use |
|--------|-----------|-------------|
| `CREATE_PATIENT` | CREATE | New patient registration |
| `UPDATE_PATIENT` | UPDATE | Patient information update |
| `VIEW_PATIENT` | READ | Patient record access (HIPAA) |
| `DELETE_PATIENT` | DELETE | Patient soft deletion |

### Appointments Domain

| Action | Event Type | When to Use |
|--------|-----------|-------------|
| `CREATE_APPOINTMENT` | CREATE | New appointment booking |
| `UPDATE_APPOINTMENT` | UPDATE | Appointment modification |
| `VIEW_APPOINTMENT` | READ | Appointment record access |
| `COMPLETE_APPOINTMENT` | UPDATE | Marking appointment as done |
| `CANCEL_APPOINTMENT` | UPDATE | Appointment cancellation |

## Method Signature Patterns

### For Service Methods

**CREATE:**
```typescript
async create(dto: CreateDto, userId: string, workspaceId: string) {
  try {
    const result = await this.performCreate(dto);

    // Audit success
    try {
      await this.auditLogService.log({
        userId,
        action: 'CREATE_RESOURCE',
        eventType: AuditEventType.CREATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'Resource',
        resourceId: result.id,
        metadata: { /* non-PHI data */ },
      }, workspaceId);
    } catch (auditError) {
      this.logger.error('Failed to create audit log', auditError.stack);
    }

    return result;
  } catch (error) {
    // Audit failure
    try {
      await this.auditLogService.log({
        userId,
        action: 'CREATE_RESOURCE',
        eventType: AuditEventType.CREATE,
        outcome: AuditOutcome.FAILURE,
        resourceType: 'Resource',
        metadata: { error: error.message },
      }, workspaceId);
    } catch (auditError) {
      this.logger.error('Failed to create audit log', auditError.stack);
    }
    throw error;
  }
}
```

**UPDATE:**
```typescript
async update(id: string, dto: UpdateDto, userId: string, workspaceId: string) {
  try {
    // Capture previous state
    const resource = await this.findById(id);
    const previousState = { /* extract relevant fields */ };

    const result = await this.performUpdate(id, dto);
    const newState = { /* extract relevant fields */ };

    // Audit success
    try {
      await this.auditLogService.log({
        userId,
        action: 'UPDATE_RESOURCE',
        eventType: AuditEventType.UPDATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'Resource',
        resourceId: id,
        previousState,
        newState,
      }, workspaceId);
    } catch (auditError) {
      this.logger.error('Failed to create audit log', auditError.stack);
    }

    return result;
  } catch (error) {
    // Audit failure (similar to create)
    throw error;
  }
}
```

**READ (with HIPAA tracking):**
```typescript
async findOne(id: string, userId: string, workspaceId: string) {
  const resource = await this.repository.findById(id);

  if (!resource) {
    throw new NotFoundException('Resource not found');
  }

  // Audit access (non-blocking)
  try {
    await this.auditLogService.log({
      userId,
      action: 'VIEW_RESOURCE',
      eventType: AuditEventType.READ,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'Resource',
      resourceId: id,
      patientId: resource.patientId, // If applicable
      justification: 'Resource access',
    }, workspaceId);
  } catch (auditError) {
    this.logger.error('Failed to create audit log', auditError.stack);
  }

  return resource;
}
```

**DELETE:**
```typescript
async remove(id: string, userId: string, workspaceId: string) {
  try {
    await this.repository.softDelete(id);

    // Audit success
    try {
      await this.auditLogService.log({
        userId,
        action: 'DELETE_RESOURCE',
        eventType: AuditEventType.DELETE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'Resource',
        resourceId: id,
      }, workspaceId);
    } catch (auditError) {
      this.logger.error('Failed to create audit log', auditError.stack);
    }
  } catch (error) {
    // Audit failure (similar to create)
    throw error;
  }
}
```

## Controller Integration

### Example: Extracting userId and workspaceId

```typescript
@Controller('patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Post()
  async create(
    @Body() dto: CreatePatientDto,
    @Request() req,
  ) {
    const userId = req.user.id; // From JWT/auth guard
    const workspaceId = req.user.workspaceId; // From JWT/auth guard

    return this.patientsService.create(dto, userId, workspaceId);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Request() req,
  ) {
    const userId = req.user.id;
    const workspaceId = req.user.workspaceId;

    return this.patientsService.findOne(id, userId, workspaceId);
  }
}
```

## Best Practices

### 1. Always Use Try-Catch for Audit Calls

✅ **DO:**
```typescript
try {
  await this.auditLogService.log({ ... }, workspaceId);
} catch (auditError) {
  this.logger.error('Failed to create audit log', auditError.stack);
}
```

❌ **DON'T:**
```typescript
await this.auditLogService.log({ ... }, workspaceId); // May break operation if audit fails
```

### 2. Log Both Success and Failure

✅ **DO:**
```typescript
try {
  const result = await this.performOperation();
  // Log success
  await this.auditLogService.log({ outcome: AuditOutcome.SUCCESS, ... });
  return result;
} catch (error) {
  // Log failure
  await this.auditLogService.log({ outcome: AuditOutcome.FAILURE, ... });
  throw error;
}
```

❌ **DON'T:**
```typescript
const result = await this.performOperation();
await this.auditLogService.log({ ... }); // Only logs success
```

### 3. Include Patient ID for HIPAA Compliance

✅ **DO:**
```typescript
await this.auditLogService.log({
  userId,
  action: 'VIEW_APPOINTMENT',
  patientId: appointment.patientId, // Track patient access
  ...
});
```

❌ **DON'T:**
```typescript
await this.auditLogService.log({
  userId,
  action: 'VIEW_APPOINTMENT',
  // Missing patientId - HIPAA violation!
  ...
});
```

### 4. Redact PHI from Metadata

✅ **DO:**
```typescript
metadata: {
  firstName: patient.firstName,
  lastName: patient.lastName,
  city: patient.city, // Non-sensitive
}
```

❌ **DON'T:**
```typescript
metadata: {
  ssn: patient.ssn, // Will be auto-redacted, but should not be included
  medicalHistory: patient.history, // Will be auto-redacted
}
```

### 5. Use Descriptive Action Names

✅ **DO:**
```typescript
action: 'CREATE_PATIENT'
action: 'UPDATE_PATIENT'
action: 'COMPLETE_APPOINTMENT'
```

❌ **DON'T:**
```typescript
action: 'create' // Too generic
action: 'do_something' // Not descriptive
```

## PHI Redaction

The audit service automatically redacts PHI based on these patterns:

```typescript
/ssn/i
/health/i
/medical/i
/diagnosis/i
/prescription/i
/password/i
/token/i
```

**Example:**

Input:
```typescript
metadata: {
  firstName: 'John',
  ssn: '123-45-6789',
  diagnosis: 'Diabetes',
}
```

Stored in audit log:
```typescript
metadata: {
  firstName: 'John',
  ssn: '[REDACTED]',
  diagnosis: '[REDACTED]',
}
```

## Querying Audit Logs

```typescript
// In your service or controller
constructor(private readonly auditLogService: AuditLogService) {}

// Get patient access history
async getPatientAccessHistory(patientId: string, workspaceId: string) {
  return this.auditLogService.findByPatient(patientId, workspaceId);
}

// Get user activity
async getUserActivity(userId: string, workspaceId: string) {
  return this.auditLogService.findByUser(userId, workspaceId, {
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-12-31'),
  });
}

// Get resource audit trail
async getResourceHistory(resourceType: string, resourceId: string, workspaceId: string) {
  return this.auditLogService.findByResource(resourceType, resourceId, workspaceId);
}

// Get statistics
async getAuditStats(workspaceId: string) {
  return this.auditLogService.getStatistics(
    workspaceId,
    new Date('2024-01-01'),
    new Date('2024-12-31'),
  );
}

// Find suspicious activity
async getSuspiciousActivity(workspaceId: string) {
  return this.auditLogService.findSuspiciousActivity(workspaceId);
}
```

## Troubleshooting

### Audit Log Not Created

**Possible causes:**
1. AuditModule not imported in domain module
2. Missing userId or workspaceId
3. Database connection issue
4. Audit service not properly injected

**Solution:**
- Check module imports
- Verify userId and workspaceId are passed correctly
- Check Winston logs for audit errors
- Verify AuditLogService is in constructor

### Build Errors

**Common issues:**
1. Circular dependency (import cycle)
2. Missing enum imports
3. Type mismatch

**Solution:**
- Check import paths
- Import enums from `../../../common/enums`
- Verify AuditModule exports AuditLogService

### Missing Patient ID

**Issue:** HIPAA compliance requires patient ID in all patient-related operations

**Solution:**
```typescript
// Always include patientId when accessing patient data
await this.auditLogService.log({
  userId,
  action: 'VIEW_PATIENT',
  patientId: id, // Critical for HIPAA
  ...
});
```

## Summary Checklist

When integrating audit into a new service:

- [ ] Import AuditLogService and enums
- [ ] Inject AuditLogService in constructor
- [ ] Add userId and workspaceId to method signatures
- [ ] Wrap audit calls in try-catch
- [ ] Log both success and failure outcomes
- [ ] Include patientId for HIPAA compliance
- [ ] Capture previousState for updates
- [ ] Use descriptive action names
- [ ] Avoid including PHI in metadata
- [ ] Import AuditModule in domain module
- [ ] Test with npm run build
- [ ] Update controllers to pass userId/workspaceId

## Support

For questions or issues:
1. Check Winston logs for audit errors
2. Review AUDIT_INTEGRATION_COMPLETE.md
3. Check audit database table for entries
4. Verify AuditModule configuration

## Additional Resources

- **Full Documentation:** `AUDIT_INTEGRATION_COMPLETE.md`
- **Audit Domain:** `src/domains/audit/`
- **Audit Service:** `src/domains/audit/services/audit-log.service.ts`
- **Audit Module:** `src/domains/audit/audit.module.ts`
- **Common Enums:** `src/common/enums/index.ts`
