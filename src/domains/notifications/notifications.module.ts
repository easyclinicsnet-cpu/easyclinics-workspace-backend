import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';

// Entities
import { DeviceToken, Notification } from './entities';

// Controllers
import { NotificationsController } from './controllers/notifications.controller';

// Services
import { NotificationsService } from './services/notifications.service';

// Repositories
import { DeviceTokenRepository } from './repositories/device-token.repository';
import { NotificationRepository } from './repositories/notification.repository';

// Common modules
import { LoggerModule } from '../../common/logger/logger.module';
import { LoggerService } from '../../common/logger/logger.service';
import { SecurityModule } from '../../common/security/security.module';

// Audit module
import { AuditModule } from '../audit/audit.module';

/**
 * Notifications Domain Module
 *
 * Manages FCM device token registration, in-app notification persistence,
 * and push notification dispatch via Firebase Admin SDK.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([DeviceToken, Notification]),
    ConfigModule,
    LoggerModule,
    SecurityModule,
    AuditModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,

    // Repositories (non-encrypted — no PHI stored)
    {
      provide: DeviceTokenRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new DeviceTokenRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
    {
      provide: NotificationRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new NotificationRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
  ],
  exports: [
    NotificationsService,
    DeviceTokenRepository,
    NotificationRepository,
  ],
})
export class NotificationsModule {}
