# Database Module - Integration Guide

Quick guide to integrate the database module into your application.

## Step 1: Import DatabaseModule

Add `DatabaseModule` to your `AppModule`:

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from './common/database';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      // Your database config
    }),
    DatabaseModule, // Add this line
    // ... other modules
  ],
})
export class AppModule {}
```

## Step 2: Update Existing Repositories

Convert your existing repositories to extend `EncryptedRepository`:

### Before:

```typescript
import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Patient } from '../entities/patient.entity';

@Injectable()
export class PatientRepository extends Repository<Patient> {
  constructor(private dataSource: DataSource) {
    super(Patient, dataSource.manager);
  }

  async findByEmail(email: string): Promise<Patient | null> {
    return this.findOne({ where: { email } });
  }
}
```

### After:

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

  // Required: Define which encrypted fields can be searched
  protected getSearchableEncryptedFields(): string[] {
    return ['firstName', 'lastName', 'email', 'phone'];
  }

  // Required: Define base filters for queries
  protected getSearchFilters(): Partial<FindOptionsWhere<Patient>> {
    return { isDeleted: false };
  }

  // Your custom methods work as before
  async findByEmail(email: string): Promise<Patient | null> {
    return this.findOne({ where: { email } });
    // Now automatically encrypts/decrypts!
  }
}
```

## Step 3: Add TenantSchemaGuard to Controllers

Apply the guard to controllers that need workspace validation:

```typescript
import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { TenantSchemaGuard } from '@common/database';
import { Request } from 'express';

@UseGuards(TenantSchemaGuard) // Add this line
@Controller('patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Get()
  async findAll(@Req() request: Request) {
    // request.workspaceId is now validated and available
    return this.patientsService.findAll(request.workspaceId);
  }
}
```

## Step 4: Use Search Functionality

Add search endpoints in your service:

```typescript
import { Injectable } from '@nestjs/common';
import { PatientRepository } from './repositories/patient.repository';

@Injectable()
export class PatientsService {
  constructor(private readonly patientRepository: PatientRepository) {}

  async search(searchTerm: string, page: number = 1, limit: number = 10) {
    const [patients, total] = await this.patientRepository.searchEncryptedFields(
      searchTerm,
      page,
      limit,
      {
        searchFields: ['firstName', 'lastName', 'email', 'phone'],
        batchSize: 100,
        maxResults: 1000,
        useCache: true,
      }
    );

    return {
      data: patients,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
```

Add search endpoint in your controller:

```typescript
@Get('search')
async search(
  @Query('q') searchTerm: string,
  @Query('page') page: number = 1,
  @Query('limit') limit: number = 10,
) {
  return this.patientsService.search(searchTerm, page, limit);
}
```

## Step 5: Environment Configuration

Add required environment variables:

```env
# .env
WORKSPACE_ID=your-workspace-id
ENCRYPTION_KEY=your-32-character-encryption-key
JWT_SECRET_KEY=your-jwt-secret
NODE_ENV=production
LOG_LEVEL=info
```

## Step 6: Update Module Providers

Ensure repositories are provided in your feature modules:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Patient } from './entities/patient.entity';
import { PatientRepository } from './repositories/patient.repository';
import { PatientsController } from './controllers/patients.controller';
import { PatientsService } from './services/patients.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Patient]),
  ],
  controllers: [PatientsController],
  providers: [
    PatientRepository, // Add custom repository
    PatientsService,
  ],
  exports: [PatientRepository],
})
export class PatientsModule {}
```

## Optional: Use EncryptionInterceptor

For future HTTP-level encryption (currently a placeholder):

```typescript
import { Controller, Post, UseInterceptors, Body } from '@nestjs/common';
import { EncryptionInterceptor } from '@common/database';

@UseInterceptors(EncryptionInterceptor)
@Controller('sensitive')
export class SensitiveController {
  @Post()
  async handleSensitive(@Body() data: SensitiveDto) {
    // Will support encryption/decryption in future
    return data;
  }
}
```

## Testing

### Unit Tests

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { PatientRepository } from './patient.repository';
import { Aes256Service } from '@common/security';
import { LoggerService } from '@common/logger';

describe('PatientRepository', () => {
  let repository: PatientRepository;
  let aesService: jest.Mocked<Aes256Service>;
  let logger: jest.Mocked<LoggerService>;

  beforeEach(async () => {
    const mockDataSource = {
      manager: {},
    } as unknown as DataSource;

    aesService = {
      encrypt: jest.fn().mockResolvedValue('encrypted'),
      decrypt: jest.fn().mockResolvedValue('decrypted'),
    } as any;

    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatientRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: Aes256Service,
          useValue: aesService,
        },
        {
          provide: LoggerService,
          useValue: logger,
        },
      ],
    }).compile();

    repository = module.get<PatientRepository>(PatientRepository);
  });

  it('should encrypt sensitive fields on save', async () => {
    const patient = {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
    };

    await repository.encryptEntityFields(patient);

    expect(aesService.encrypt).toHaveBeenCalledTimes(3); // firstName, lastName, email
  });

  it('should decrypt sensitive fields on find', async () => {
    const encryptedPatient = {
      firstName: 'encrypted:abc123',
      lastName: 'encrypted:def456',
      email: 'encrypted:ghi789',
    };

    await repository.decryptEntityFields(encryptedPatient);

    expect(aesService.decrypt).toHaveBeenCalledTimes(3);
  });
});
```

### Integration Tests

```typescript
describe('PatientsController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/patients/search (GET)', () => {
    return request(app.getHttpServer())
      .get('/patients/search?q=john')
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('data');
        expect(res.body).toHaveProperty('meta');
      });
  });

  it('should reject requests without workspace ID', () => {
    return request(app.getHttpServer())
      .get('/patients')
      .expect(401);
  });

  it('should accept requests with valid workspace ID', () => {
    return request(app.getHttpServer())
      .get('/patients')
      .set('X-Workspace-Id', 'valid-workspace-id')
      .expect(200);
  });
});
```

## Troubleshooting

### "Cannot find module '@common/database'"

Update your `tsconfig.json` paths:

```json
{
  "compilerOptions": {
    "paths": {
      "@common/*": ["src/common/*"]
    }
  }
}
```

### "Workspace context required"

Ensure you're sending workspace ID in one of:
1. X-Workspace-Id header
2. JWT token payload
3. Query parameter (development only)

### "Decryption failed"

Check that:
1. ENCRYPTION_KEY is set correctly
2. Data was encrypted with the same key
3. Encrypted format is correct (contains `:` and looks like base64)

### Search not finding results

1. Verify fields are in `getSearchableEncryptedFields()`
2. Check `getSearchFilters()` isn't too restrictive
3. Try disabling cache: `useCache: false`
4. Check logs for encryption/decryption errors

## Performance Tuning

### For High-Volume Systems:

```typescript
// Increase batch size
const [results] = await repository.searchEncryptedFields(
  'term',
  1,
  20,
  {
    batchSize: 200,     // Default: 100
    maxResults: 2000,   // Default: 1000
    useCache: true,
  }
);
```

### For Real-Time Systems:

```typescript
// Disable caching for fresh data
const [results] = await repository.searchEncryptedFields(
  'term',
  1,
  20,
  {
    useCache: false,
  }
);
```

### For Memory-Constrained Systems:

```typescript
// Reduce batch size
const [results] = await repository.searchEncryptedFields(
  'term',
  1,
  20,
  {
    batchSize: 50,      // Smaller batches
    maxResults: 500,    // Limit total results
  }
);
```

## Migration Checklist

- [ ] Import DatabaseModule into AppModule
- [ ] Update all repositories to extend EncryptedRepository
- [ ] Add TenantSchemaGuard to multi-tenant controllers
- [ ] Configure environment variables
- [ ] Update module providers
- [ ] Add search endpoints
- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Test encryption/decryption
- [ ] Test workspace validation
- [ ] Monitor performance
- [ ] Review logs

## Need Help?

See the full documentation in [README.md](./README.md) for:
- Detailed API reference
- Architecture explanation
- Performance optimization
- Security considerations
- Advanced usage examples

## Quick Reference

### Import Paths:
```typescript
import { EncryptedRepository, TenantSchemaGuard, EncryptionInterceptor } from '@common/database';
import { Aes256Service } from '@common/security';
import { LoggerService } from '@common/logger';
```

### Required Dependencies:
```typescript
constructor(
  dataSource: DataSource,
  aesService: Aes256Service,
  logger: LoggerService,
) {
  super(Entity, dataSource, aesService, logger);
  this.logger.setContext('YourRepository');
}
```

### Required Methods:
```typescript
protected getSearchableEncryptedFields(): string[] {
  return ['field1', 'field2'];
}

protected getSearchFilters(): Partial<FindOptionsWhere<Entity>> {
  return { isDeleted: false };
}
```
