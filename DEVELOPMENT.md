# Development Guide - EasyClinics EMR Backend

## 🎯 Development Workflow

This guide explains how to develop new features following the established architecture.

---

## 📐 Architecture Principles

### 1. Domain-Driven Design (DDD)
- Code is organized by **business domains**, not technical layers
- Each domain owns its data, logic, and API
- No cross-domain service imports (use events or APIs instead)

### 2. Feature-First Organization
```
src/domains/<domain-name>/
├── entities/          # Database models
├── dto/              # Data Transfer Objects
├── controllers/      # API endpoints
├── services/         # Business logic
├── repositories/     # Data access (if needed)
├── interfaces/       # TypeScript interfaces
└── <domain>.module.ts # Module definition
```

### 3. No Global Service Directories
❌ **Don't do this:**
```
src/
├── controllers/  (all controllers)
├── services/     (all services)
└── entities/     (all entities)
```

✅ **Do this instead:**
```
src/domains/
├── patients/
│   ├── controllers/
│   ├── services/
│   └── entities/
└── billing/
    ├── controllers/
    ├── services/
    └── entities/
```

---

## 🔨 Adding a New Feature

### Example: Add "Create Patient" Endpoint

#### Step 1: Create DTO
```typescript
// src/domains/patients/dto/create-patient.dto.ts
import { IsString, IsEmail, IsOptional, IsNotEmpty } from 'class-validator';

export class CreatePatientDto {
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsString()
  @IsNotEmpty()
  gender: string;

  @IsString()
  @IsNotEmpty()
  birthDate: string;

  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  city?: string;
}
```

#### Step 2: Create Service
```typescript
// src/domains/patients/services/patients.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Patient } from '../entities/patient.entity';
import { CreatePatientDto } from '../dto/create-patient.dto';

@Injectable()
export class PatientsService {
  constructor(
    @InjectRepository(Patient)
    private readonly patientsRepository: Repository<Patient>,
  ) {}

  async create(createPatientDto: CreatePatientDto): Promise<Patient> {
    const patient = this.patientsRepository.create(createPatientDto);
    return this.patientsRepository.save(patient);
  }

  async findAll(): Promise<Patient[]> {
    return this.patientsRepository.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Patient> {
    const patient = await this.patientsRepository.findOne({
      where: { id, isActive: true },
    });

    if (!patient) {
      throw new NotFoundException(`Patient with ID ${id} not found`);
    }

    return patient;
  }

  async update(id: string, updatePatientDto: Partial<CreatePatientDto>): Promise<Patient> {
    const patient = await this.findOne(id);
    Object.assign(patient, updatePatientDto);
    return this.patientsRepository.save(patient);
  }

  async softDelete(id: string): Promise<void> {
    const patient = await this.findOne(id);
    patient.isActive = false;
    patient.deletedAt = new Date();
    await this.patientsRepository.save(patient);
  }
}
```

#### Step 3: Create Controller
```typescript
// src/domains/patients/controllers/patients.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PatientsService } from '../services/patients.service';
import { CreatePatientDto } from '../dto/create-patient.dto';
import { Patient } from '../entities/patient.entity';

@Controller('patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createPatientDto: CreatePatientDto): Promise<Patient> {
    return this.patientsService.create(createPatientDto);
  }

  @Get()
  findAll(): Promise<Patient[]> {
    return this.patientsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<Patient> {
    return this.patientsService.findOne(id);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() updatePatientDto: Partial<CreatePatientDto>,
  ): Promise<Patient> {
    return this.patientsService.update(id, updatePatientDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.patientsService.softDelete(id);
  }
}
```

#### Step 4: Update Module
```typescript
// src/domains/patients/patients.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Patient } from './entities/patient.entity';
import { Allergy } from './entities/allergy.entity';
import { Vital } from './entities/vital.entity';
import { SocialHistory } from './entities/social-history.entity';
import { PatientsController } from './controllers/patients.controller';
import { PatientsService } from './services/patients.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Patient,
      Allergy,
      Vital,
      SocialHistory,
    ]),
  ],
  controllers: [PatientsController],
  providers: [PatientsService],
  exports: [PatientsService, TypeOrmModule],
})
export class PatientsModule {}
```

---

## 🧪 Testing

### Unit Tests
```typescript
// src/domains/patients/services/patients.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PatientsService } from './patients.service';
import { Patient } from '../entities/patient.entity';

describe('PatientsService', () => {
  let service: PatientsService;
  let repository: Repository<Patient>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatientsService,
        {
          provide: getRepositoryToken(Patient),
          useClass: Repository,
        },
      ],
    }).compile();

    service = module.get<PatientsService>(PatientsService);
    repository = module.get<Repository<Patient>>(getRepositoryToken(Patient));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a patient', async () => {
      const createPatientDto = {
        firstName: 'John',
        lastName: 'Doe',
        gender: 'Male',
        birthDate: '1990-01-01',
      };

      const patient = { id: '1', ...createPatientDto } as Patient;

      jest.spyOn(repository, 'create').mockReturnValue(patient);
      jest.spyOn(repository, 'save').mockResolvedValue(patient);

      expect(await service.create(createPatientDto)).toEqual(patient);
    });
  });
});
```

### E2E Tests
```typescript
// test/patients.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';

describe('PatientsController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/patients (POST)', () => {
    return request(app.getHttpServer())
      .post('/patients')
      .send({
        firstName: 'John',
        lastName: 'Doe',
        gender: 'Male',
        birthDate: '1990-01-01',
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });
});
```

---

## 🔒 Security Best Practices

### 1. Input Validation
- Always use DTOs with class-validator decorators
- Validate all user inputs at the controller level

### 2. Data Encryption
For sensitive fields marked as "Encrypted field":
```typescript
// Implement encryption utility
import * as crypto from 'crypto';

export class EncryptionService {
  private readonly algorithm = 'aes-256-cbc';
  private readonly key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');

  encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  decrypt(text: string): string {
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
```

### 3. Audit Logging
Log all sensitive operations:
```typescript
// Create audit log entry
await this.auditLogRepository.save({
  userId: currentUser.id,
  action: 'CREATE_PATIENT',
  eventType: 'PATIENT_MANAGEMENT',
  outcome: 'SUCCESS',
  metadata: { patientId: patient.id },
});
```

---

## 📊 Database Patterns

### Soft Deletes
Always use soft deletes for data retention:
```typescript
async softDelete(id: string): Promise<void> {
  const entity = await this.findOne(id);
  entity.isActive = false;
  entity.deletedAt = new Date();
  entity.deletedBy = currentUser.id; // from auth context
  await this.repository.save(entity);
}
```

### Querying Active Records
```typescript
// Always filter by isActive unless explicitly querying deleted records
const patients = await this.repository.find({
  where: { isActive: true },
});
```

---

## 🚦 Error Handling

### Standard Error Responses
```typescript
import { NotFoundException, BadRequestException } from '@nestjs/common';

// Not found
throw new NotFoundException(`Patient with ID ${id} not found`);

// Bad request
throw new BadRequestException('Invalid patient data provided');

// Custom errors
import { HttpException, HttpStatus } from '@nestjs/common';
throw new HttpException('Patient already exists', HttpStatus.CONFLICT);
```

---

## 📝 Code Style Guidelines

### 1. Naming Conventions
- **Entities**: PascalCase (e.g., `Patient`, `Appointment`)
- **Services**: PascalCase with Service suffix (e.g., `PatientsService`)
- **Controllers**: PascalCase with Controller suffix (e.g., `PatientsController`)
- **DTOs**: PascalCase with Dto suffix (e.g., `CreatePatientDto`)
- **Interfaces**: PascalCase with I prefix (e.g., `IPatient`)

### 2. File Naming
- **Entities**: `*.entity.ts`
- **Services**: `*.service.ts`
- **Controllers**: `*.controller.ts`
- **DTOs**: `*.dto.ts`
- **Modules**: `*.module.ts`
- **Tests**: `*.spec.ts`

### 3. Import Order
```typescript
// 1. External dependencies
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

// 2. Entities
import { Patient } from './entities/patient.entity';

// 3. Services
import { PatientsService } from './services/patients.service';

// 4. Controllers
import { PatientsController } from './controllers/patients.controller';
```

---

## 🔄 Git Workflow

1. Create feature branch: `git checkout -b feature/patient-management`
2. Make changes following the architecture
3. Write tests
4. Commit with meaningful messages
5. Push and create pull request
6. Request code review

### Commit Message Format
```
feat(patients): add create patient endpoint

- Add CreatePatientDto with validation
- Implement PatientsService.create()
- Add POST /patients endpoint
- Include unit tests
```

---

## 🎓 Learning Resources

- [NestJS Documentation](https://docs.nestjs.com/)
- [TypeORM Documentation](https://typeorm.io/)
- [Domain-Driven Design](https://martinfowler.com/bliki/DomainDrivenDesign.html)
- [Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
