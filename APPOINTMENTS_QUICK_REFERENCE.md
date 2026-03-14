# Appointments Module - Quick Reference Guide

## Usage Examples

### 1. Import the Module

```typescript
import { AppointmentsModule } from './domains/appointments';

@Module({
  imports: [AppointmentsModule],
})
export class AppModule {}
```

### 2. Use the Service

```typescript
import { AppointmentsService } from './domains/appointments';

@Injectable()
export class MyService {
  constructor(private appointmentsService: AppointmentsService) {}

  async createAppointment(userId: string, workspaceId: string) {
    // Create appointment with cash payment
    const cashAppointment = await this.appointmentsService.create(
      {
        patientId: 'patient-uuid',
        type: AppointmentType.INITIAL,
        date: '2024-01-15',
        time: '14:30',
        paymentMethod: PaymentMethodType.CASH,
      },
      userId,
      workspaceId,
    );

    // Create appointment with insurance
    const insuranceAppointment = await this.appointmentsService.create(
      {
        patientId: 'patient-uuid',
        type: AppointmentType.ROUTINE,
        date: '2024-01-20',
        time: '10:00',
        paymentMethod: PaymentMethodType.INSURANCE,
        insuranceProviderId: 'provider-uuid',
        schemeId: 'scheme-uuid',
        membershipNumber: 'MED123456',
        memberType: 'PRINCIPAL',
        updatePatientInsurance: true, // Update patient's insurance record
      },
      userId,
      workspaceId,
    );

    // Query appointments
    const appointments = await this.appointmentsService.findAll(
      {
        page: 1,
        limit: 10,
        status: AppointmentStatus.SCHEDULED,
        date: new Date('2024-01-15'),
        search: 'John', // Encrypted search on patient name
      },
      workspaceId,
    );

    // Mark as done
    await this.appointmentsService.markAsDone(appointmentId, workspaceId);

    // Cancel appointment
    await this.appointmentsService.cancelAppointment(appointmentId, workspaceId);
  }
}
```

### 3. Use the Repository Directly

```typescript
import { AppointmentRepository } from './domains/appointments';

@Injectable()
export class MyService {
  constructor(private appointmentRepo: AppointmentRepository) {}

  async getTodaysAppointments(workspaceId: string) {
    return this.appointmentRepo.getTodaysAppointments(workspaceId, 1, 10);
  }

  async getUpcomingAppointments(workspaceId: string) {
    return this.appointmentRepo.getUpcomingAppointments(workspaceId, 1, 10, 7);
  }

  async searchAppointments(workspaceId: string, searchTerm: string) {
    return this.appointmentRepo.searchAppointments({
      workspaceId,
      search: searchTerm,
      page: 1,
      limit: 10,
    });
  }
}
```

---

## API Endpoint Examples (When Controllers Added)

### Create Appointment

```http
POST /api/appointments
Content-Type: application/json
Authorization: Bearer <token>
X-Workspace-Id: <workspace-uuid>

{
  "patientId": "patient-uuid",
  "type": "INITIAL",
  "date": "2024-01-15",
  "time": "14:30",
  "paymentMethod": "CASH"
}
```

### Create Appointment with Insurance

```http
POST /api/appointments
Content-Type: application/json
Authorization: Bearer <token>
X-Workspace-Id: <workspace-uuid>

{
  "patientId": "patient-uuid",
  "type": "ROUTINE",
  "date": "2024-01-20",
  "time": "10:00",
  "paymentMethod": "INSURANCE",
  "insuranceProviderId": "provider-uuid",
  "schemeId": "scheme-uuid",
  "membershipNumber": "MED123456",
  "memberType": "PRINCIPAL",
  "updatePatientInsurance": true
}
```

### Query Appointments

```http
GET /api/appointments?page=1&limit=10&status=SCHEDULED&search=John
Authorization: Bearer <token>
X-Workspace-Id: <workspace-uuid>
```

### Update Appointment

```http
PATCH /api/appointments/:id
Content-Type: application/json
Authorization: Bearer <token>
X-Workspace-Id: <workspace-uuid>

{
  "time": "15:00",
  "status": "IN_PROGRESS"
}
```

### Mark as Done

```http
POST /api/appointments/:id/mark-done
Authorization: Bearer <token>
X-Workspace-Id: <workspace-uuid>
```

### Cancel Appointment

```http
POST /api/appointments/:id/cancel
Authorization: Bearer <token>
X-Workspace-Id: <workspace-uuid>
```

---

## Common Query Patterns

### Today's Scheduled Appointments

```typescript
const today = await appointmentsService.findAll(
  {
    date: new Date(),
    status: AppointmentStatus.SCHEDULED,
    page: 1,
    limit: 50,
  },
  workspaceId,
);
```

### Patient History

```typescript
const history = await appointmentsService.findAll(
  {
    patientId: 'patient-uuid',
    includeCancelled: true,
    sortBy: 'date',
    sortDirection: 'DESC',
    page: 1,
    limit: 20,
  },
  workspaceId,
);
```

### Date Range Query

```typescript
const rangeAppointments = await appointmentsService.findAll(
  {
    startDate: '2024-01-01',
    endDate: '2024-01-31',
    status: AppointmentStatus.COMPLETED,
    page: 1,
    limit: 100,
  },
  workspaceId,
);
```

### Search by Patient Name (Encrypted)

```typescript
const searchResults = await appointmentsService.findAll(
  {
    search: 'John Doe',
    page: 1,
    limit: 10,
  },
  workspaceId,
);
```

---

## Enums Reference

### AppointmentStatus

```typescript
enum AppointmentStatus {
  SCHEDULED = 'SCHEDULED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  MISSED = 'MISSED',
}
```

### AppointmentType

```typescript
enum AppointmentType {
  INITIAL = 'INITIAL',
  REVIEW = 'REVIEW',
  ROUTINE = 'ROUTINE',
  EMERGENCY = 'EMERGENCY',
}
```

### PaymentMethodType

```typescript
enum PaymentMethodType {
  CASH = 'CASH',
  INSURANCE = 'INSURANCE',
  CREDIT_CARD = 'CREDIT_CARD',
  DEBIT_CARD = 'DEBIT_CARD',
  BANK_TRANSFER = 'BANK_TRANSFER',
  MOBILE_MONEY = 'MOBILE_MONEY',
  // ... other payment methods
}
```

---

## Error Handling

### Insurance Validation Error

```typescript
try {
  await appointmentsService.create(dto, userId, workspaceId);
} catch (error) {
  if (error instanceof BadRequestException) {
    // Error: [
    //   "Insurance provider is required for INSURANCE payment method",
    //   "Insurance scheme is required for INSURANCE payment method",
    //   ...
    // ]
  }
}
```

### Not Found Error

```typescript
try {
  await appointmentsService.findOne('invalid-id', workspaceId);
} catch (error) {
  if (error instanceof NotFoundException) {
    // Error: "Appointment not found"
  }
}
```

---

## Transaction Guarantees

All mutations are atomic:

1. **Create with Insurance**: Appointment + Patient Insurance created/updated in single transaction
2. **Update with Insurance**: Appointment + Patient Insurance updated in single transaction
3. **Mark as Done**: Appointment + Consultation updated in single transaction
4. **Cancel**: Appointment + Consultation updated in single transaction

If any step fails, entire transaction rolls back.

---

## Performance Notes

### Encrypted Search

- **Batch Size**: 100 records per batch
- **Max Results**: 2000 appointments
- **Cache TTL**: 5 minutes
- **Fuzzy Matching**: Jaro-Winkler algorithm (threshold: 0.8)

### Indexing

Multi-tenant composite indexes ensure fast queries:
- `(workspaceId, patientId)`
- `(workspaceId, date)`
- `(workspaceId, status)`
- `(workspaceId, isActive)`

---

## Multi-Tenancy

**CRITICAL**: All service methods REQUIRE `workspaceId` parameter.

```typescript
// ❌ WRONG - Missing workspaceId
await appointmentsService.findAll(query);

// ✅ CORRECT
await appointmentsService.findAll(query, workspaceId);
```

**Workspace Isolation**: Each tenant's data is completely isolated. No cross-workspace queries possible.

---

## Relations Loading

To load relations, use `TypeORM` find options:

```typescript
const appointment = await appointmentRepo.findOne({
  where: { id, workspaceId },
  relations: [
    'patient',
    'consultation',
    'prescriptions',
    'patientBill',
    'consumablePartialUsages',
    'medicationPartialSales',
  ],
});
```

---

## Logging

All operations logged with Winston:

```typescript
this.logger.log('Creating appointment for patient ${patientId}');
this.logger.warn('Appointment not found: ${id}');
this.logger.error('Error message', error.stack);
```

Context: `AppointmentsService` or `AppointmentRepository`

---

## Best Practices

1. **Always pass workspaceId** in service method calls
2. **Use transactions** for multi-step operations
3. **Validate insurance** when payment method is INSURANCE
4. **Load relations** explicitly when needed
5. **Use encrypted search** for patient name queries
6. **Handle errors** gracefully (BadRequestException, NotFoundException)
7. **Log operations** for audit trail
8. **Paginate results** for large datasets

---

## Integration Checklist

- [ ] Import `AppointmentsModule` in your app module
- [ ] Set up `ENCRYPTION_KEY` in environment variables
- [ ] Configure Winston logger
- [ ] Set up multi-tenancy middleware (extract workspaceId from request)
- [ ] Create API controllers (if needed)
- [ ] Write integration tests
- [ ] Configure TypeORM entities in app module
- [ ] Set up database migrations

---

## Support

For issues or questions:
1. Check `APPOINTMENTS_MIGRATION_COMPLETE.md` for detailed architecture
2. Review source code in `src/domains/appointments/`
3. Check Winston logs for operation details
4. Verify multi-tenancy setup (workspaceId in all queries)
5. Ensure all required entities are imported in app module
