import { Injectable } from '@nestjs/common';
import { Repository, DataSource, FindOptionsWhere } from 'typeorm';

import { LoggerService } from '../../../common/logger/logger.service';
import { Notification } from '../entities';
import { QueryNotificationsDto } from '../dto';

@Injectable()
export class NotificationRepository extends Repository<Notification> {
  constructor(
    dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    super(Notification, dataSource.createEntityManager());
    this.logger.setContext('NotificationRepository');
  }

  /** Paginated list filtered by workspace + user. */
  async findPaginated(
    workspaceId: string,
    userId: string,
    query: QueryNotificationsDto,
  ): Promise<[Notification[], number]> {
    const where: FindOptionsWhere<Notification> = {
      workspaceId,
      userId,
      isDismissed: false,
    };

    if (query.isRead !== undefined) {
      where.isRead = query.isRead;
    }

    return this.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: ((query.page ?? 1) - 1) * (query.limit ?? 20),
      take: query.limit ?? 20,
    });
  }

  /** Count of unread, non-dismissed notifications for badge display. */
  async countUnread(workspaceId: string, userId: string): Promise<number> {
    return this.count({
      where: { workspaceId, userId, isRead: false, isDismissed: false },
    });
  }

  /** Mark a single notification as read, scoped to workspace. */
  async markRead(id: string, userId: string, workspaceId: string): Promise<void> {
    await this.update({ id, userId, workspaceId }, { isRead: true });
  }

  /** Mark all notifications as read for a user in a workspace. */
  async markAllRead(workspaceId: string, userId: string): Promise<void> {
    await this.update(
      { workspaceId, userId, isRead: false },
      { isRead: true },
    );
  }

  /** Dismiss a single notification (soft-hide from list), scoped to workspace. */
  async dismiss(id: string, userId: string, workspaceId: string): Promise<void> {
    await this.update({ id, userId, workspaceId }, { isDismissed: true });
  }

  /** Dismiss all notifications for a user in a workspace. */
  async dismissAll(workspaceId: string, userId: string): Promise<void> {
    await this.update(
      { workspaceId, userId, isDismissed: false },
      { isDismissed: true },
    );
  }

  /**
   * Dismiss all notifications linked to a specific transcription job.
   * Used when the client dismisses a real-time WebSocket notification that
   * does not yet have the backend notification ID (backendId is null).
   */
  async dismissByJobId(
    jobId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    await this.createQueryBuilder()
      .update()
      .set({ isDismissed: true })
      .where('workspaceId = :workspaceId', { workspaceId })
      .andWhere('userId = :userId', { userId })
      .andWhere('isDismissed = :isDismissed', { isDismissed: false })
      .andWhere(
        "JSON_UNQUOTE(JSON_EXTRACT(data, '$.jobId')) = :jobId",
        { jobId },
      )
      .execute();
  }

  /**
   * Dismiss all transcription notifications linked to a specific consultation.
   * Called when the doctor approves the AI-generated note so the notification
   * clears automatically without requiring explicit user dismissal.
   */
  async dismissByConsultationId(
    consultationId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    await this.createQueryBuilder()
      .update()
      .set({ isDismissed: true })
      .where('workspaceId = :workspaceId', { workspaceId })
      .andWhere('userId = :userId', { userId })
      .andWhere('isDismissed = :isDismissed', { isDismissed: false })
      .andWhere(
        "JSON_UNQUOTE(JSON_EXTRACT(data, '$.consultationId')) = :consultationId",
        { consultationId },
      )
      .execute();
  }
}
