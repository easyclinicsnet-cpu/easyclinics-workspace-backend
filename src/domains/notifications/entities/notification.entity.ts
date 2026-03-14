import {
  Entity,
  Column,
  Index,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { IsUUID } from 'class-validator';

/**
 * Persisted in-app notification record.
 *
 * Mirrors the client-side AppNotification model.  Keeping a server-side
 * record means the user can fetch missed notifications on app launch and
 * the notification badge count is authoritative across devices.
 */
@Entity('notifications')
@Index('idx_notifications_workspace', ['workspaceId'])
@Index('idx_notifications_user', ['userId'])
@Index('idx_notifications_user_read', ['userId', 'isRead'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  @IsUUID()
  id: string;

  @Column({ type: 'varchar', length: 255 })
  @IsUUID()
  workspaceId: string;

  @Column({ type: 'varchar', length: 255 })
  @IsUUID()
  userId: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  body?: string;

  /** Discriminator for notification routing on the client */
  @Column({ type: 'varchar', length: 50 })
  type: string; // 'transcription_completed' | 'transcription_failed' | ...

  /** Optional foreign key to the related resource */
  @Column({ type: 'varchar', length: 255, nullable: true })
  resourceId?: string;

  /** Arbitrary metadata for deep-linking (jobId, consultationId, …) */
  @Column({ type: 'json', nullable: true })
  data?: Record<string, any>;

  @Column({ type: 'boolean', default: false })
  isRead: boolean;

  @Column({ type: 'boolean', default: false })
  isDismissed: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6 })
  updatedAt: Date;
}
