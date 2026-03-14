/**
 * NotificationsService
 *
 * Manages FCM device token registration, in-app notification persistence,
 * and push notification dispatch via Firebase Admin SDK.
 *
 * ┌─ Firebase Admin Setup ──────────────────────────────────────────────────────┐
 * │  Requires FIREBASE_SERVICE_ACCOUNT_PATH env var pointing to the service    │
 * │  account JSON file, OR FIREBASE_PROJECT_ID for Application Default Creds.  │
 * │  If neither is set the service logs a warning and skips push delivery.     │
 * └────────────────────────────────────────────────────────────────────────────┘
 */

import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { join } from 'path';

import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { AuditEventType, AuditOutcome } from '../../../common/enums';
import { DeviceTokenRepository } from '../repositories/device-token.repository';
import { NotificationRepository } from '../repositories/notification.repository';
import { RegisterDeviceDto } from '../dto';
import { DeviceToken } from '../entities/device-token.entity';
import { Notification } from '../entities/notification.entity';
import { QueryNotificationsDto } from '../dto';

// ─── Payload shape for internal callers ──────────────────────────────────────

export interface SendNotificationPayload {
  workspaceId: string;
  userId: string;
  title: string;
  body?: string;
  type: string;           // 'transcription_completed' | 'transcription_failed' | …
  resourceId?: string;
  data?: Record<string, string>;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class NotificationsService implements OnModuleInit {
  private firebaseInitialized = false;

  constructor(
    private readonly deviceTokenRepo: DeviceTokenRepository,
    private readonly notificationRepo: NotificationRepository,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext('NotificationsService');
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    this.initFirebase();
  }

  private initFirebase(): void {
    // Skip if already initialized (e.g. in tests or multi-module scenarios)
    if (admin.apps.length > 0) {
      this.firebaseInitialized = true;
      return;
    }

    const serviceAccountPath = this.configService.get<string>(
      'FIREBASE_SERVICE_ACCOUNT_PATH',
    );

    try {
      if (serviceAccountPath) {
        // Always relative to process.cwd() (project root) — same pattern as
        // AUTH_PUBLIC_KEY in workspace-jwt.guard.ts. Battle-tested on both
        // Windows dev and Linux prod regardless of compiled output structure.
        const absolutePath = join(process.cwd(), serviceAccountPath);
        const serviceAccount = JSON.parse(
          readFileSync(absolutePath, 'utf8'),
        );
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
        this.firebaseInitialized = true;
        this.logger.log(
          `Firebase Admin SDK initialized with service account (${serviceAccountPath})`,
        );
      } else {
        // Try Application Default Credentials (works on GCP / Cloud Run)
        const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
        if (projectId) {
          admin.initializeApp({
            credential: admin.credential.applicationDefault(),
            projectId,
          });
          this.firebaseInitialized = true;
          this.logger.log('Firebase Admin SDK initialized with ADC');
        } else {
          this.logger.warn(
            'Firebase not configured — set FIREBASE_SERVICE_ACCOUNT_PATH or ' +
              'FIREBASE_PROJECT_ID to enable push notifications',
          );
        }
      }
    } catch (err) {
      this.logger.error(
        'Failed to initialize Firebase Admin SDK',
        (err as Error).stack,
      );
    }
  }

  // ─── Device Token Management ─────────────────────────────────────────────

  async registerDevice(
    workspaceId: string,
    userId: string,
    dto: RegisterDeviceDto,
  ): Promise<DeviceToken> {
    this.logger.log(
      `Registering device token for user ${userId} (${dto.platform})`,
    );

    try {
      // Revoke this physical device token from any other user that may have
      // registered it previously (shared-device scenario). This ensures only
      // the currently authenticated user receives push notifications on this
      // device — the previous user's registration is silently deactivated.
      await this.deviceTokenRepo.deactivateTokenForOtherUsers(
        dto.deviceToken,
        userId,
      );

      const result = await this.deviceTokenRepo.upsertToken({
        workspaceId,
        userId,
        deviceToken: dto.deviceToken,
        platform: dto.platform,
        deviceName: dto.deviceName,
      });

      try {
        await this.auditLogService.log({
          userId,
          action: 'REGISTER_DEVICE',
          eventType: AuditEventType.CREATE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'DeviceToken',
          resourceId: result.id,
          justification: 'FCM device token registration for push notifications',
          metadata: {
            platform: dto.platform,
            deviceName: dto.deviceName,
            tokenPrefix: dto.deviceToken.substring(0, 20),
          },
        }, workspaceId);
      } catch (auditError) {
        this.logger.error('Failed to create audit log for registerDevice', (auditError as Error).stack);
      }

      return result;
    } catch (error) {
      try {
        await this.auditLogService.log({
          userId,
          action: 'REGISTER_DEVICE',
          eventType: AuditEventType.CREATE,
          outcome: AuditOutcome.FAILURE,
          resourceType: 'DeviceToken',
          justification: 'FCM device token registration failed',
          metadata: {
            platform: dto.platform,
            error: (error as Error).message,
          },
        }, workspaceId);
      } catch (auditError) {
        this.logger.error('Failed to create audit log for registerDevice failure', (auditError as Error).stack);
      }
      throw error;
    }
  }

  async unregisterDevice(
    userId: string,
    deviceToken: string,
    workspaceId: string,
  ): Promise<void> {
    this.logger.log(`Unregistering device token for user ${userId} in workspace ${workspaceId}`);
    // Deactivate only this workspace's registration — preserves push for other active workspaces
    await this.deviceTokenRepo.deactivateByUserAndWorkspace(userId, deviceToken, workspaceId);

    try {
      await this.auditLogService.log({
        userId,
        action: 'UNREGISTER_DEVICE',
        eventType: AuditEventType.DELETE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'DeviceToken',
        justification: 'FCM device token deactivation (logout or token invalidation)',
        metadata: {
          tokenPrefix: deviceToken.substring(0, 20),
        },
      }, workspaceId);
    } catch (auditError) {
      this.logger.error('Failed to create audit log for unregisterDevice', (auditError as Error).stack);
    }
  }

  async getDevices(userId: string): Promise<DeviceToken[]> {
    return this.deviceTokenRepo.findActiveByUser(userId);
  }

  // ─── Notification CRUD ───────────────────────────────────────────────────

  async listNotifications(
    workspaceId: string,
    userId: string,
    query: QueryNotificationsDto,
  ): Promise<{ data: Notification[]; total: number; unreadCount: number }> {
    const [data, total] = await this.notificationRepo.findPaginated(
      workspaceId,
      userId,
      query,
    );
    const unreadCount = await this.notificationRepo.countUnread(
      workspaceId,
      userId,
    );
    return { data, total, unreadCount };
  }

  async markRead(
    notificationId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    await this.notificationRepo.markRead(notificationId, userId, workspaceId);
  }

  async markAllRead(workspaceId: string, userId: string): Promise<void> {
    await this.notificationRepo.markAllRead(workspaceId, userId);
  }

  async dismiss(notificationId: string, userId: string, workspaceId: string): Promise<void> {
    await this.notificationRepo.dismiss(notificationId, userId, workspaceId);
  }

  async dismissAll(workspaceId: string, userId: string): Promise<void> {
    await this.notificationRepo.dismissAll(workspaceId, userId);
  }

  async getUnreadCount(workspaceId: string, userId: string): Promise<number> {
    return this.notificationRepo.countUnread(workspaceId, userId);
  }

  /**
   * Dismiss all notifications related to a transcription job.
   * Used by the client when a real-time notification (no backendId) is dismissed.
   * Best-effort — never throws so callers are unaffected on failure.
   */
  async dismissByJobId(
    jobId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    try {
      await this.notificationRepo.dismissByJobId(jobId, userId, workspaceId);
    } catch (err) {
      this.logger.warn(
        `dismissByJobId failed for job ${jobId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Dismiss all notifications related to a consultation (e.g. on note approval).
   * Best-effort — never throws so callers are unaffected on failure.
   */
  async dismissByConsultationId(
    consultationId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    try {
      await this.notificationRepo.dismissByConsultationId(consultationId, userId, workspaceId);
    } catch (err) {
      this.logger.warn(
        `dismissByConsultationId failed for consultation ${consultationId}: ${(err as Error).message}`,
      );
    }
  }

  // ─── Send Notification (persist + push) ──────────────────────────────────

  /**
   * Creates an in-app notification record AND dispatches a push notification
   * to the user's devices registered under the same workspace.
   *
   * Called internally by other services (e.g. TranscriptionJobService) —
   * not exposed via HTTP.
   */
  async send(payload: SendNotificationPayload): Promise<Notification> {
    // 1. Persist in-app notification
    const notification = await this.notificationRepo.save(
      this.notificationRepo.create({
        workspaceId: payload.workspaceId,
        userId: payload.userId,
        title: payload.title,
        body: payload.body,
        type: payload.type,
        resourceId: payload.resourceId,
        data: payload.data as any,
      }),
    );

    // 2. Send push notification to all active devices
    await this.sendPushToUser(payload);

    return notification;
  }

  // ─── Firebase Push Dispatch ──────────────────────────────────────────────

  private async sendPushToUser(
    payload: SendNotificationPayload,
  ): Promise<void> {
    if (!this.firebaseInitialized) return;

    // Scope push to devices registered under the SAME workspace as the
    // notification. Prevents phantom pushes on devices logged into a
    // different workspace (where the in-app notification won't exist).
    const tokens = await this.deviceTokenRepo.findActiveByUserAndWorkspace(
      payload.userId,
      payload.workspaceId,
    );
    if (tokens.length === 0) return;

    const fcmTokens = tokens.map((t) => t.deviceToken);

    const message: admin.messaging.MulticastMessage = {
      tokens: fcmTokens,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: {
        type: payload.type,
        ...(payload.resourceId ? { resourceId: payload.resourceId } : {}),
        ...(payload.data ?? {}),
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'easyclinics_transcriptions',
          icon: 'ic_notification',
          color: '#059669',
        },
      },
      apns: {
        payload: {
          aps: {
            badge: await this.notificationRepo.countUnread(
              payload.workspaceId,
              payload.userId,
            ),
            sound: 'default',
          },
        },
      },
    };

    try {
      const response = await admin.messaging().sendEachForMulticast(message);

      // Deactivate stale tokens
      if (response.failureCount > 0) {
        response.responses.forEach((resp, idx) => {
          if (resp.error) {
            const code = resp.error.code;
            if (
              code === 'messaging/invalid-registration-token' ||
              code === 'messaging/registration-token-not-registered'
            ) {
              this.logger.warn(
                `Deactivating stale FCM token: ${fcmTokens[idx].substring(0, 20)}…`,
              );
              this.deviceTokenRepo.deactivateToken(fcmTokens[idx]);
            }
          }
        });

        // Audit push delivery failure
        try {
          await this.auditLogService.log({
            userId: payload.userId,
            action: 'SEND_PUSH_NOTIFICATION',
            eventType: AuditEventType.OTHER,
            outcome: AuditOutcome.FAILURE,
            resourceType: 'Notification',
            resourceId: payload.resourceId,
            justification: `Push notification dispatch — ${response.failureCount} device(s) failed`,
            metadata: {
              type: payload.type,
              successCount: response.successCount,
              failureCount: response.failureCount,
              totalDevices: fcmTokens.length,
            },
          }, payload.workspaceId);
        } catch (auditError) {
          this.logger.error('Failed to create audit log for push failure', (auditError as Error).stack);
        }
      }

      this.logger.log(
        `Push sent to ${response.successCount}/${fcmTokens.length} devices ` +
          `for user ${payload.userId}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to send push notification: ${(err as Error).message}`,
        (err as Error).stack,
      );

      try {
        await this.auditLogService.log({
          userId: payload.userId,
          action: 'SEND_PUSH_NOTIFICATION',
          eventType: AuditEventType.OTHER,
          outcome: AuditOutcome.FAILURE,
          resourceType: 'Notification',
          resourceId: payload.resourceId,
          justification: 'Push notification dispatch failed (Firebase error)',
          metadata: {
            type: payload.type,
            error: (err as Error).message,
          },
        }, payload.workspaceId);
      } catch (auditError) {
        this.logger.error('Failed to create audit log for push error', (auditError as Error).stack);
      }
    }
  }
}
