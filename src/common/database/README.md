# Database Module

Enterprise-grade database utilities for the EasyClinics EMR system with automatic encryption, multi-tenancy support, and advanced search capabilities.

## Features

### 1. EncryptedRepository (Base Repository)

Abstract base repository that extends TypeORM's Repository with automatic encryption/decryption capabilities.

#### Features:
- **Automatic Encryption/Decryption**: Sensitive fields are automatically encrypted before saving and decrypted when reading
- **Encrypted Field Search**: Search across encrypted fields using fuzzy matching (Jaro-Winkler algorithm)
- **Result Caching**: 5-minute TTL cache for search results with LRU eviction
- **Batch Processing**: Efficient processing of large datasets in configurable batches
- **Circular Reference Safety**: WeakSet-based protection against circular references
- **Type Safety**: Full TypeScript support with generics

#### Usage Example:

```typescript
import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere } from 'typeorm';
import { EncryptedRepository } from '@common/database';
import { Aes256Service } from '@common/security';
import { LoggerService } from '@common/logger';
import { Patient } from '../entities/patient.entity';

@Injectable()
export class PatientRepository extends EncryptedRepository<Patient> {
  constructor(
    dataSource: DataSource,
    aesService: Aes256Service,
    logger: LoggerService,
  ) {
    super(Patient, dataSource, aesService, logger);
    this.logger.setContext('PatientRepository');
  }

  // Define which encrypted fields can be searched
  protected getSearchableEncryptedFields(): string[] {
    return ['firstName', 'lastName', 'email', 'phone', 'nationalId'];
  }

  // Define base filters for search queries
  protected getSearchFilters(): Partial<FindOptionsWhere<Patient>> {
    return {
      isDeleted: false,
      isActive: true
    };
  }

  // Add custom methods as needed
  async findByNationalId(nationalId: string): Promise<Patient | null> {
    return this.findOne({ where: { nationalId } });
  }
}
```

#### Search Functionality:

```typescript
// Search across encrypted fields
const [patients, total] = await patientRepository.searchEncryptedFields(
  'john doe',
  1,  // page
  10, // limit
  {
    searchFields: ['firstName', 'lastName', 'email'],
    batchSize: 100,
    maxResults: 1000,
    useCache: true,
  }
);

// Results are automatically decrypted
console.log(patients[0].firstName); // "John"
```

#### Search Algorithm:

The search uses a three-tier matching strategy:

1. **Exact Substring Match**: Fast check for exact substring presence
2. **Multi-word Match**: All search words must be present (order-independent)
3. **Fuzzy Match**: Jaro-Winkler similarity algorithm (threshold: 0.8)

#### Encrypted Fields:

By default, these field patterns are considered sensitive:
- Explicit fields: `content`, `firstName`, `lastName`, `email`, `phone`, `ssn`, `nationalId`, `address`, `chiefComplaint`, `description`, `assessment`, `medicine`, `dose`, `route`, `frequency`, `days`
- Pattern-based: Fields matching `/(password|secret|token|creditCard|private|medical|health)/i`

Override `isSensitiveField()` to customize:

```typescript
protected isSensitiveField(key: string): boolean {
  const customSensitiveFields = ['customField', 'anotherField'];
  return customSensitiveFields.includes(key) || super.isSensitiveField(key);
}
```

### 2. TenantSchemaGuard

Multi-tenancy guard that validates workspace context for every request.

#### Features:
- **Multi-source Extraction**: JWT, headers, query parameters
- **Workspace Validation**: Validates against expected workspace ID
- **Security Auditing**: Comprehensive logging for security events
- **Request Enrichment**: Attaches validated workspace ID to request

#### Usage Example:

```typescript
import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { TenantSchemaGuard } from '@common/database';
import { Request } from 'express';

@UseGuards(TenantSchemaGuard)
@Controller('patients')
export class PatientsController {
  @Get()
  async findAll(@Req() request: Request) {
    // request.workspaceId is guaranteed to be validated
    const workspaceId = request.workspaceId;
    return this.patientsService.findAll(workspaceId);
  }
}
```

#### Configuration:

```env
# .env file
WORKSPACE_ID=your-workspace-id
NODE_ENV=production
```

#### Extraction Priority:

1. **JWT Payload** (set by auth middleware): `request.workspaceId`
2. **X-Workspace-Id Header**: `X-Workspace-Id: workspace-123`
3. **Query Parameter** (development only): `?workspaceId=workspace-123`

### 3. EncryptionInterceptor

HTTP interceptor for request/response encryption (placeholder for future implementation).

#### Usage Example:

```typescript
import { Controller, Post, UseInterceptors, Body } from '@nestjs/common';
import { EncryptionInterceptor } from '@common/database';

@UseInterceptors(EncryptionInterceptor)
@Controller('sensitive')
export class SensitiveController {
  @Post()
  async handleSensitive(@Body() data: SensitiveDto) {
    // TODO: Request/response will be encrypted in future implementation
    return data;
  }
}
```

## Architecture

```
src/common/database/
├── repositories/
│   ├── encrypted-repository.base.ts   # Base repository with encryption
│   └── index.ts
├── interceptors/
│   ├── encryption.interceptor.ts      # HTTP encryption (placeholder)
│   └── index.ts
├── guards/
│   ├── tenant-schema.guard.ts         # Multi-tenancy guard
│   └── index.ts
├── database.module.ts                 # Main module
├── index.ts                           # Barrel exports
└── README.md                          # This file
```

## Performance Considerations

### Search Performance:

- **Batch Size**: Default 100 records per batch
  - Increase for faster processing (more memory)
  - Decrease for memory-constrained environments

- **Cache TTL**: 5 minutes
  - Balances freshness vs performance
  - Cache uses LRU eviction (max 100 entries)

- **Max Results**: Default 1000
  - Prevents excessive memory usage
  - Paginate results for better UX

### Optimization Tips:

```typescript
// For large datasets with frequent searches
const [results, total] = await repository.searchEncryptedFields(
  'search term',
  1,
  20,
  {
    batchSize: 200,      // Larger batches
    maxResults: 500,     // Limit total processing
    useCache: true,      // Enable caching
  }
);

// For real-time data
const [results, total] = await repository.searchEncryptedFields(
  'search term',
  1,
  20,
  {
    useCache: false,     // Disable caching
  }
);
```

## Security

### Encryption:
- Uses AES-256 encryption via `Aes256Service`
- Encrypted format detection prevents double-encryption
- Graceful error handling (logs but continues)

### Multi-tenancy:
- Workspace ID validation on every request
- Prevents cross-tenant data access
- Comprehensive security event logging

### Audit Trail:
- All security events logged via Winston
- Includes request metadata (IP, user agent, path)
- Failed validation attempts tracked

## Error Handling

All operations include comprehensive error handling:

```typescript
// Encryption failure
try {
  await repository.save(entity);
} catch (error) {
  // Error logged, original value preserved
  // Operation continues (fail-safe)
}

// Decryption failure
try {
  const entity = await repository.findOne({ where: { id } });
} catch (error) {
  // Error logged, encrypted value preserved
  // Allows manual recovery
}

// Search failure
try {
  const [results] = await repository.searchEncryptedFields('term');
} catch (error) {
  // Error logged for specific entities
  // Other results still returned
}
```

## Logging

All components use Winston logging via `LoggerService`:

```typescript
// Set context for better log organization
this.logger.setContext('YourRepository');

// Log levels
this.logger.log('Info message');
this.logger.warn('Warning message');
this.logger.error('Error message', error.stack);
this.logger.debug('Debug message');
```

## Testing

### Unit Testing:

```typescript
describe('PatientRepository', () => {
  let repository: PatientRepository;
  let dataSource: DataSource;
  let aesService: Aes256Service;
  let logger: LoggerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatientRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: Aes256Service,
          useValue: mockAesService,
        },
        {
          provide: LoggerService,
          useValue: mockLogger,
        },
      ],
    }).compile();

    repository = module.get<PatientRepository>(PatientRepository);
  });

  it('should encrypt sensitive fields on save', async () => {
    const patient = { firstName: 'John', lastName: 'Doe' };
    await repository.save(patient);
    expect(mockAesService.encrypt).toHaveBeenCalled();
  });
});
```

## Migration from Workspace

This module is migrated from `workspace-emr-backend` with:

- ✅ 100% business logic parity
- ✅ Winston logging (replaced console/NestJS Logger)
- ✅ Enhanced JSDoc documentation
- ✅ Enterprise code quality
- ✅ Full TypeScript type safety
- ✅ Comprehensive error handling

## Dependencies

- `typeorm`: ORM functionality
- `@nestjs/common`: NestJS decorators and utilities
- `@nestjs/config`: Configuration management
- `@common/security`: AES-256 encryption service
- `@common/logger`: Winston logging service

## Best Practices

1. **Always extend EncryptedRepository** for entities with sensitive data
2. **Define searchable fields** explicitly in `getSearchableEncryptedFields()`
3. **Use TenantSchemaGuard** on all multi-tenant controllers
4. **Set context** for logger in repository constructor
5. **Handle errors gracefully** - encryption failures shouldn't crash the app
6. **Test encryption** in non-production environments first
7. **Monitor cache** hit rates for search optimization
8. **Validate workspace** context at controller level

## Troubleshooting

### Search not finding results:
- Check if fields are in `getSearchableEncryptedFields()`
- Verify fields are being encrypted/decrypted correctly
- Try disabling cache: `useCache: false`
- Check search filters in `getSearchFilters()`

### Encryption errors:
- Verify `ENCRYPTION_KEY` is set in environment
- Check if AES service is properly initialized
- Look for double-encryption attempts
- Review logs for specific error messages

### Workspace validation failing:
- Ensure `WORKSPACE_ID` matches expected value
- Check if workspace ID is in JWT payload or headers
- Review `NODE_ENV` for query parameter support
- Check logs for extraction source

## Future Enhancements

- [ ] Implement full EncryptionInterceptor logic
- [ ] Add encryption key rotation support
- [ ] Implement query-level encryption for database columns
- [ ] Add metrics/monitoring for search performance
- [ ] Support for encrypted field indexing
- [ ] Advanced fuzzy matching algorithms (Levenshtein, Soundex)
- [ ] Distributed caching (Redis) for search results
- [ ] Real-time encryption status dashboard

## License

Proprietary - EasyClinics EMR System
