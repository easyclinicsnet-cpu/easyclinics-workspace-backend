# Quick Start Guide - EasyClinics EMR Backend

## 🚀 Get Running in 5 Minutes

### Step 1: Configure Database (1 minute)
```bash
# Open .env file and update your database password
DB_PASSWORD=your_password_here
```

### Step 2: Start the Server (1 minute)
```bash
# Start development server with hot-reload
npm run start:dev
```

### Step 3: Test the API (1 minute)
```bash
# Open your browser or use curl
curl http://localhost:3000/api/v1

# Expected response:
# {"message":"Hello World!"}
```

**That's it! You're running! 🎉**

---

## 📖 What's Next?

### Create Your First Endpoint (Example: List Patients)

#### 1. Create the Service
```typescript
// src/domains/patients/services/patients.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Patient } from '../entities/patient.entity';

@Injectable()
export class PatientsService {
  constructor(
    @InjectRepository(Patient)
    private patientsRepository: Repository<Patient>,
  ) {}

  async findAll(): Promise<Patient[]> {
    return this.patientsRepository.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }
}
```

#### 2. Create the Controller
```typescript
// src/domains/patients/controllers/patients.controller.ts
import { Controller, Get } from '@nestjs/common';
import { PatientsService } from '../services/patients.service';

@Controller('patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Get()
  findAll() {
    return this.patientsService.findAll();
  }
}
```

#### 3. Update the Module
```typescript
// src/domains/patients/patients.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Patient, Allergy, Vital, SocialHistory } from './entities';
import { PatientsController } from './controllers/patients.controller';
import { PatientsService } from './services/patients.service';

@Module({
  imports: [TypeOrmModule.forFeature([Patient, Allergy, Vital, SocialHistory])],
  controllers: [PatientsController],
  providers: [PatientsService],
  exports: [PatientsService],
})
export class PatientsModule {}
```

#### 4. Test Your Endpoint
```bash
# The server will auto-reload
curl http://localhost:3000/api/v1/patients

# You should see a JSON array of patients!
```

---

## 🔥 Common Commands

```bash
# Development
npm run start:dev          # Start with hot-reload

# Production
npm run build             # Build for production
npm run start:prod        # Start production server

# Code Quality
npm run format            # Format code
npm run lint              # Lint code

# Testing
npm test                  # Run unit tests
npm run test:watch        # Tests in watch mode
npm run test:cov          # Test coverage
npm run test:e2e          # End-to-end tests
```

---

## 🗂️ Project Structure at a Glance

```
src/domains/
├── patients/       → Patient management
├── appointments/   → Scheduling
├── consultations/  → Medical consultations
├── billing/        → Bills & payments
├── insurance/      → Insurance claims
├── inventory/      → Medication & supplies
├── care-notes/     → Medical notes
└── audit/          → Audit logging
```

---

## 🎯 Quick Reference

### API Endpoints
- Base URL: `http://localhost:3000/api/v1`
- Example: `GET /api/v1/patients`

### Environment Variables
- Port: `PORT=3000` (default)
- Database: Check `.env` file
- JWT: Update secrets in production

### Database
- Type: MySQL
- Name: `a9fa7d31-7597-45c0-a15c-1ec2eea6ca0b`
- Tables: Already exist (no migrations needed)

---

## 📚 Documentation Files

- **SETUP.md** - Detailed installation and configuration
- **DEVELOPMENT.md** - Complete development guide with examples
- **PROJECT_SUMMARY.md** - What's been built and status
- **README.md** - Architecture overview

---

## 💡 Tips

1. **Hot Reload**: Changes auto-reload in dev mode
2. **Type Safety**: TypeScript catches errors before runtime
3. **Validation**: DTOs automatically validate input
4. **Logging**: Check console for detailed logs
5. **Database**: Uses existing tables (no sync needed)

---

## 🆘 Troubleshooting

### Port Already in Use
```bash
# Change port in .env
PORT=3001
```

### Database Connection Error
```bash
# Check .env credentials
DB_HOST=127.0.0.1
DB_USERNAME=root
DB_PASSWORD=your_password
```

### Build Errors
```bash
# Clean install
rm -rf node_modules dist
npm install
npm run build
```

---

## 🎓 Learn More

- [NestJS Docs](https://docs.nestjs.com/)
- [TypeORM Guide](https://typeorm.io/)
- Read `DEVELOPMENT.md` for patterns and examples

---

**You're all set! Happy coding! 🚀**
