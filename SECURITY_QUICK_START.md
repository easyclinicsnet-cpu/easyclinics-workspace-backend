# Security Infrastructure Quick Start Guide

## Overview
This guide provides quick instructions for using the migrated security infrastructure in your application.

---

## Installation Complete
✅ All security modules migrated and compiled successfully
✅ Dependencies installed: `@nestjs/cache-manager`, `cache-manager`
✅ Build verified: No errors or warnings

---

## Quick Setup

### 1. Environment Configuration

Create or update your `.env` file:

```env
# Required for Encryption
ENCRYPTION_KEY=your-32-character-or-longer-encryption-key-here

# Required for JWT Authentication
AUTH_PUBLIC_KEY=keys/public.pem
JWT_SECRET_KEY=your-jwt-secret-key
JWT_ISSUER=easyclinics-emr
JWT_EXPIRATION=1h

# Required for Workspace Validation
WORKSPACE_ID=your-workspace-uuid
DOMAIN=easyclinics.com

# Environment
NODE_ENV=development
```

### 2. Generate RSA Keys (if not already done)

```bash
# Generate private key
openssl genrsa -out keys/private.pem 2048

# Generate public key
openssl rsa -in keys/private.pem -pubout -out keys/public.pem
```

### 3. Import SecurityModule in AppModule

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SecurityModule } from './common/security';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRoot({
      // your database config
    }),
    SecurityModule, // ✅ Import here
  ],
})
export class AppModule {}
```

### 4. Run Database Migration

```bash
# Generate migration
npm run typeorm migration:generate -- -n CreateAuditLog

# Run migration
npm run typeorm migration:run
```

---

## Usage Examples

### Protect Routes with JWT Authentication

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { WorkspaceJwtGuard } from '@/common/security';

@Controller('api/patients')
@UseGuards(WorkspaceJwtGuard) // ✅ Apply guard
export class PatientsController {
  @Get()
  findAll() {
    return 'Protected route';
  }
}
```

### Add Audit Logging

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { WorkspaceJwtGuard, AuditGuard } from '@/common/security';

@Controller('api/sensitive')
@UseGuards(WorkspaceJwtGuard, AuditGuard) // ✅ Apply both guards
export class SensitiveController {
  @Get()
  getData() {
    return 'All requests are logged';
  }
}
```

### Use Encryption Service

```typescript
import { Injectable } from '@nestjs/common';
import { Aes256Service } from '@/common/security';

@Injectable()
export class PatientService {
  constructor(private readonly aes256: Aes256Service) {}

  async encryptSSN(ssn: string): Promise<string> {
    return this.aes256.encrypt(ssn);
  }

  async decryptSSN(encryptedSSN: string): Promise<string> {
    return this.aes256.decrypt(encryptedSSN);
  }
}
```

### Access User Context in Controllers

```typescript
import { Controller, Get, Request } from '@nestjs/common';

@Controller('api/user')
export class UserController {
  @Get('profile')
  getProfile(@Request() req) {
    return {
      userId: req.userId,        // ✅ Available after JWT guard
      workspaceId: req.workspaceId, // ✅ Available after JWT guard
      user: req.user,            // ✅ Full user object
    };
  }
}
```

---

## Module Exports

### SecurityModule Exports
- `Aes256Module` - Encryption module (dynamic)
- `WorkspaceJwtGuard` - JWT authentication guard
- `ActivityLogService` - Audit logging service
- `AuditGuard` - Automatic request audit guard
- `JwtModule` - JWT module (re-exported)

### Available Imports

```typescript
// Import everything
import { SecurityModule } from '@/common/security';

// Import specific components
import {
  Aes256Module,
  Aes256Service,
  WorkspaceJwtGuard,
  ActivityLogService,
  AuditGuard
} from '@/common/security';

// Import decorators
import {
  EncryptedField,
  Decrypted,
  WithEncryption
} from '@/common/security';
```

---

## Testing Your Setup

### 1. Test Encryption

```typescript
import { Test } from '@nestjs/testing';
import { Aes256Module, Aes256Service } from '@/common/security';
import { ConfigModule } from '@nestjs/config';

describe('Encryption Test', () => {
  let service: Aes256Service;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(),
        Aes256Module.register({ key: 'test-key-at-least-32-characters-long' }),
      ],
    }).compile();

    service = module.get<Aes256Service>(Aes256Service);
  });

  it('should encrypt and decrypt', async () => {
    const plaintext = 'sensitive data';
    const encrypted = await service.encrypt(plaintext);
    const decrypted = await service.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });
});
```

### 2. Test JWT Guard

```bash
# Make request without token
curl http://localhost:3000/api/patients
# Expected: 401 Unauthorized

# Make request with valid token
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" http://localhost:3000/api/patients
# Expected: 200 OK
```

### 3. Verify Audit Logs

```sql
-- Check audit log table
SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 10;
```

---

## Common Issues & Solutions

### Issue: "Encryption key must be at least 32 characters"
**Solution:** Ensure `ENCRYPTION_KEY` in `.env` is 32+ characters

### Issue: "Failed to load public key"
**Solution:**
1. Check `AUTH_PUBLIC_KEY` path in `.env`
2. Ensure the file exists and is PEM formatted
3. Check file permissions

### Issue: "Token validation failed - AUTH_004"
**Solution:**
1. Verify `JWT_ISSUER` matches token issuer
2. Check `WORKSPACE_ID` and `DOMAIN` are correct
3. Ensure token audience matches expected format

### Issue: "Cannot find module '@nestjs/cache-manager'"
**Solution:** Already installed during migration. Run `npm install` if needed.

### Issue: AuditLog entity not found
**Solution:** Run database migrations to create the `audit_log` table

---

## Security Checklist

Before deploying to production:

- [ ] Generate strong RSA keys (2048-bit minimum)
- [ ] Use strong `ENCRYPTION_KEY` (32+ random characters)
- [ ] Use strong `JWT_SECRET_KEY`
- [ ] Keep private keys secure (never commit to git)
- [ ] Set `NODE_ENV=production`
- [ ] Enable HTTPS
- [ ] Configure proper CORS
- [ ] Set up Redis for token caching (optional)
- [ ] Implement token revocation mechanism
- [ ] Set up audit log retention policy
- [ ] Enable rate limiting
- [ ] Configure firewall rules
- [ ] Run security audit

---

## Performance Optimization

### 1. Enable Redis Caching (Optional)

```typescript
import { CacheModule } from '@nestjs/cache-manager';
import * as redisStore from 'cache-manager-redis-store';

@Module({
  imports: [
    CacheModule.register({
      store: redisStore,
      host: 'localhost',
      port: 6379,
      ttl: 300,
    }),
    SecurityModule,
  ],
})
export class AppModule {}
```

### 2. Database Indexing

Ensure indexes are created on:
- `audit_log.userId`
- `audit_log.eventType`
- `audit_log.timestamp`

---

## Support

For issues or questions:
1. Check `SECURITY_MIGRATION_COMPLETE.md` for detailed documentation
2. Review source files in `src/common/security/`
3. Contact EasyClinics EMR security team

---

**Last Updated:** 2026-02-16
**Version:** 1.0.0
