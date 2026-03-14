# Audit Domain

## Quick Start

The Audit Domain provides comprehensive HIPAA-compliant audit logging for the multi-tenant EMR system.

## What's Included

### Entities (3)
- **AuditLog**: General audit trail with PHI redaction
- **AuditContext**: Complex operation tracking
- **NoteAuditLog**: Clinical note audit logging

### Services (3)
- **AuditLogService**: General audit logging with PHI redaction
- **AuditContextService**: Transaction and context tracking
- **NoteAuditService**: Specialized note audit logging

### Repositories (3)
- **AuditLogRepository**: Complex filtering and querying
- **AuditContextRepository**: Context management
- **NoteAuditLogRepository**: Note audit queries

### DTOs (9)
- Create, Query, and Response DTOs for all entities
- Pagination support
- Comprehensive filtering

## Features

- Multi-tenancy (workspaceId in all entities)
- HIPAA compliance (patient access tracking, justification)
- PHI redaction (automatic sensitive data masking)
- Immutable audit logs (append-only)
- Winston logging throughout
- Complex indexing for performance
- Anomaly detection support
- Retention policy support

## Code Statistics

- **Total Lines**: 2,409 lines of TypeScript
- **Entities**: 303 lines
- **DTOs**: 450 lines
- **Repositories**: 685 lines
- **Services**: 858 lines
- **Module**: 92 lines
- **Documentation**: Comprehensive

## Usage

```typescript
import { AuditLogService, AuditEventType, AuditOutcome } from '@domains/audit';

// Log an action
await auditLogService.log({
  userId: 'user-123',
  action: 'CREATE_PATIENT',
  eventType: AuditEventType.CREATE,
  outcome: AuditOutcome.SUCCESS,
  resourceType: 'Patient',
  resourceId: patient.id,
  patientId: patient.id,
  justification: 'New patient registration',
}, workspaceId);
```

## Documentation

See [AUDIT_DOMAIN_COMPLETE.md](./AUDIT_DOMAIN_COMPLETE.md) for comprehensive documentation including:
- Architecture overview
- Entity descriptions
- Service API reference
- HIPAA compliance features
- Usage examples
- Best practices
- Integration guides
- Testing strategies

## Configuration

Add to `.env`:
```env
AUDIT_RETENTION_DAYS=730
AUDIT_HIPAA_MODE=true
AUDIT_ANOMALY_DETECTION=true
```

See `src/config/audit.config.ts` for all configuration options.

## Next Steps

1. Run database migrations to create audit tables
2. Import AuditModule in app.module.ts
3. Inject AuditLogService in your services
4. Start logging actions with proper workspaceId

## Compliance

This audit domain is designed to meet:
- HIPAA audit log requirements
- Multi-tenant data isolation
- PHI protection standards
- Immutable audit trail requirements
- 6+ year retention support
