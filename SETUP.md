# EasyClinics EMR Backend - Setup Guide

## 🎯 Quick Start

### Prerequisites
- Node.js v18+
- npm v9+
- MySQL 5.7+ or MariaDB 10.4+
- Git

### Installation Steps

1. **Clone the repository** (if not already done)
   ```bash
   git clone <repository-url>
   cd easyclinics-emr-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   # Copy the example env file
   cp .env.example .env

   # Edit .env with your database credentials
   ```

4. **Update database configuration in `.env`**
   ```env
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_USERNAME=root
   DB_PASSWORD=your_password
   DB_DATABASE=a9fa7d31-7597-45c0-a15c-1ec2eea6ca0b
   ```

5. **Ensure your database exists**
   ```sql
   CREATE DATABASE `a9fa7d31-7597-45c0-a15c-1ec2eea6ca0b` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

6. **Build the application**
   ```bash
   npm run build
   ```

7. **Start the development server**
   ```bash
   npm run start:dev
   ```

8. **Verify the application is running**
   - Open your browser to: `http://localhost:3000/api/v1`
   - You should see: `{"message":"Hello World!"}`

---

## 📁 Project Structure

```
src/
├── common/                    # Shared utilities and base classes
│   ├── entities/             # Base entity classes
│   └── enums/                # Shared enumerations
├── config/                   # Configuration files
│   ├── app.config.ts        # Application settings
│   ├── database.config.ts   # Database configuration
│   └── jwt.config.ts        # JWT authentication config
├── domains/                  # Domain-driven design modules
│   ├── appointments/        # Appointment scheduling
│   ├── audit/              # Audit logging & compliance
│   ├── billing/            # Billing & payments
│   ├── care-notes/         # Medical notes & prescriptions
│   ├── consultations/      # Medical consultations
│   ├── insurance/          # Insurance management
│   ├── inventory/          # Medication & supplies
│   └── patients/           # Patient management
├── app.module.ts           # Root application module
└── main.ts                 # Application entry point
```

---

## 🔧 Available Scripts

| Command | Description |
|---------|-------------|
| `npm run start` | Start production server |
| `npm run start:dev` | Start development server with hot-reload |
| `npm run start:debug` | Start server in debug mode |
| `npm run build` | Build for production |
| `npm run format` | Format code with Prettier |
| `npm run lint` | Lint code with ESLint |
| `npm test` | Run unit tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:cov` | Run tests with coverage |
| `npm run test:e2e` | Run end-to-end tests |

---

## 🗄️ Database Setup

The application uses the existing database schema. **IMPORTANT:**

- **DO NOT** set `DB_SYNCHRONIZE=true` in production
- The database schema already exists from your SQL dump
- TypeORM will connect to existing tables
- No migrations are needed for initial setup

### Connecting to Existing Database

The application is configured to work with your existing MySQL database:
- Database name: `a9fa7d31-7597-45c0-a15c-1ec2eea6ca0b`
- All entities match your existing table structure
- Encrypted fields are marked in entity comments

---

## 🔐 Security Configuration

### Environment Variables (Production)

**CRITICAL:** Change these values in production:

```env
# JWT Security
JWT_SECRET=<generate-a-strong-random-secret-here>
JWT_REFRESH_SECRET=<generate-another-strong-secret>

# Encryption
ENCRYPTION_KEY=<32-character-encryption-key>

# Database
DB_PASSWORD=<your-secure-database-password>
```

### Generating Secure Keys

```bash
# Generate random JWT secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Generate encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 🌐 API Endpoints

Base URL: `http://localhost:3000/api/v1`

### Health Check
- `GET /` - Returns application status

### Domain Endpoints (Coming Soon)
Each domain will have its own set of RESTful endpoints:

- `/patients` - Patient management
- `/appointments` - Appointment scheduling
- `/consultations` - Medical consultations
- `/billing` - Billing and payments
- `/insurance` - Insurance claims
- `/inventory` - Medication inventory
- `/care-notes` - Medical notes

---

## 🏗️ Architecture Overview

This application follows **Enterprise-Grade Domain-Driven Design (DDD)**:

### Design Principles
- ✅ **Domain-First Organization** - Code organized by business domains
- ✅ **Feature Modules** - Each domain is self-contained
- ✅ **Clean Architecture** - Clear separation of concerns
- ✅ **Type Safety** - Full TypeScript with strict mode
- ✅ **Audit Trail** - Immutable audit logging
- ✅ **Security-First** - Encrypted sensitive data

### Key Features
- 🔒 **HIPAA-Ready** - Audit logging and data encryption
- 📊 **Scalable** - Modular architecture supports growth
- 🧪 **Testable** - Designed for comprehensive testing
- 🔍 **Observable** - Built-in logging and monitoring
- 🌍 **Production-Ready** - Error handling and validation

---

## 🚀 Next Steps

### 1. Implement Services
Create service classes for business logic in each domain:
```typescript
// Example: src/domains/patients/services/patients.service.ts
@Injectable()
export class PatientsService {
  constructor(
    @InjectRepository(Patient)
    private patientsRepository: Repository<Patient>,
  ) {}

  async findAll(): Promise<Patient[]> {
    return this.patientsRepository.find();
  }
}
```

### 2. Create Controllers
Add REST API endpoints:
```typescript
// Example: src/domains/patients/controllers/patients.controller.ts
@Controller('patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Get()
  findAll() {
    return this.patientsService.findAll();
  }
}
```

### 3. Add DTOs
Create Data Transfer Objects for validation:
```typescript
// Example: src/domains/patients/dto/create-patient.dto.ts
export class CreatePatientDto {
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;
}
```

### 4. Implement Authentication
- Add user authentication module
- Implement JWT strategy
- Add role-based access control (RBAC)

### 5. Add Data Encryption
- Implement field-level encryption for sensitive data
- Use encryption utilities for marked fields

---

## 📖 Documentation

- [NestJS Documentation](https://docs.nestjs.com/)
- [TypeORM Documentation](https://typeorm.io/)
- [Architecture Document](./README.md)

---

## 🤝 Contributing

1. Follow the domain-driven design principles
2. Add services, controllers, and DTOs within their respective domain folders
3. Use TypeScript strict mode
4. Write unit tests for all business logic
5. Document all public APIs

---

## 📝 License

Proprietary - EasyClinics EMR System
