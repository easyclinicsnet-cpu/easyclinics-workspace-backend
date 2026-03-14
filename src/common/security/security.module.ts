import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { TypeOrmModule } from '@nestjs/typeorm';

// Import all security components
import { Aes256Module } from './encryption/aes-256.module';
import { WorkspaceJwtGuard } from './auth/workspace-jwt.guard';
import { RolesGuard } from './auth/roles.guard';
import { PermissionsGuard } from './auth/permissions.guard';
import { ActivityLogService } from './audit/activity-log.service';
import { AuditGuard } from './audit/audit.guard';
import { AuditLog } from '../../modules/audit-log/entities/audit-log.entity';

@Module({
  imports: [
    // Dynamic encryption module
    Aes256Module.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        key: config.get<string>('ENCRYPTION_KEY') || '',
        salt: config.getOrThrow<string>('ENCRYPTION_SALT'),
      }),
      inject: [ConfigService],
    }),

    // JWT module for token validation
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET_KEY'),
        signOptions: {
          expiresIn: '1h',
        },
      }),
      inject: [ConfigService],
    }),

    // Cache module for token caching
    CacheModule.register(),

    // TypeORM for audit log entity
    TypeOrmModule.forFeature([AuditLog]),
  ],
  providers: [
    WorkspaceJwtGuard,
    RolesGuard,
    PermissionsGuard,
    ActivityLogService,
    AuditGuard,
  ],
  exports: [
    Aes256Module,
    CacheModule,
    WorkspaceJwtGuard,
    RolesGuard,
    PermissionsGuard,
    ActivityLogService,
    AuditGuard,
    JwtModule,
  ],
})
export class SecurityModule {}
