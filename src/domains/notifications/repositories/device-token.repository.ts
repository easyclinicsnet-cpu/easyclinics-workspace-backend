import { Injectable } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';

import { LoggerService } from '../../../common/logger/logger.service';
import { DeviceToken } from '../entities';

@Injectable()
export class DeviceTokenRepository extends Repository<DeviceToken> {
  constructor(
    dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    super(DeviceToken, dataSource.createEntityManager());
    this.logger.setContext('DeviceTokenRepository');
  }

  /**
   * Find all active tokens for a user across ALL workspaces.
   * Used internally by FCM push dispatch so notifications reach the device
   * regardless of which workspace is currently active.
   */
  async findActiveByUser(userId: string): Promise<DeviceToken[]> {
    return this.find({
      where: { userId, isActive: true },
      order: { updatedAt: 'DESC' },
    });
  }

  /**
   * Find active tokens for a user scoped to a specific workspace.
   * Used by HTTP endpoints to avoid leaking cross-workspace device info.
   */
  async findActiveByUserAndWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<DeviceToken[]> {
    return this.find({
      where: { userId, workspaceId, isActive: true },
      order: { updatedAt: 'DESC' },
    });
  }

  /**
   * Upsert a device token scoped to a workspace.
   * De-duplicates on (userId + deviceToken + workspaceId) so the same physical
   * device can hold separate registrations for different workspaces without
   * one workspace silently overwriting another's record.
   */
  async upsertToken(partial: Partial<DeviceToken>): Promise<DeviceToken> {
    const existing = await this.findOne({
      where: {
        userId: partial.userId,
        deviceToken: partial.deviceToken,
        workspaceId: partial.workspaceId,
      },
    });

    if (existing) {
      existing.platform = partial.platform ?? existing.platform;
      existing.deviceName = partial.deviceName ?? existing.deviceName;
      existing.isActive = true;
      return this.save(existing);
    }

    return this.save(this.create(partial));
  }

  /**
   * Deactivate a token for a specific user + workspace (logout / workspace switch).
   * Scoped so logging out of workspace A does not kill push for workspace B.
   */
  async deactivateByUserAndWorkspace(
    userId: string,
    deviceToken: string,
    workspaceId: string,
  ): Promise<void> {
    await this.update({ userId, deviceToken, workspaceId }, { isActive: false });
  }

  /**
   * Globally deactivate a stale token (called when FCM reports it invalid).
   * Intentionally workspace-agnostic — a stale FCM token is stale everywhere.
   */
  async deactivateToken(deviceToken: string): Promise<void> {
    await this.update({ deviceToken }, { isActive: false });
  }

  /**
   * Deactivate a specific FCM token for every user EXCEPT the given one.
   *
   * A physical device always has the same FCM token regardless of which account
   * is logged in. Calling this when a new user registers a token ensures that
   * the previous user's registration for that same physical device is revoked,
   * preventing notifications meant for one user from appearing on a device now
   * signed in as another user (shared-device scenario).
   */
  async deactivateTokenForOtherUsers(
    deviceToken: string,
    userId: string,
  ): Promise<void> {
    await this.createQueryBuilder()
      .update(DeviceToken)
      .set({ isActive: false })
      .where('"deviceToken" = :token AND "userId" != :userId', {
        token: deviceToken,
        userId,
      })
      .execute();
  }

  /** Remove all tokens for a user (e.g. on account deletion). */
  async removeByUser(userId: string): Promise<void> {
    await this.delete({ userId });
  }
}
