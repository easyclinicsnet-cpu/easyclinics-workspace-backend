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
 * Stores FCM device tokens for push notification delivery.
 *
 * A user may have multiple devices (phone, tablet), so the composite
 * unique constraint is (userId + deviceToken) rather than (userId) alone.
 *
 * workspaceId is stored for multi-tenancy scoping but NOT part of the
 * unique constraint — the same physical device token belongs to the same
 * Firebase project regardless of which workspace is active.  When a user
 * switches workspaces the token stays valid; the service simply routes
 * the notification to the correct workspace context.
 */
@Entity('device_tokens')
@Index('idx_device_tokens_workspace', ['workspaceId'])
@Index('idx_device_tokens_user', ['userId'])
@Index('idx_device_tokens_user_token', ['userId', 'deviceToken'], { unique: true })
export class DeviceToken {
  @PrimaryGeneratedColumn('uuid')
  @IsUUID()
  id: string;

  @Column({ type: 'varchar', length: 255 })
  @IsUUID()
  workspaceId: string;

  @Column({ type: 'varchar', length: 255 })
  @IsUUID()
  userId: string;

  /** Firebase Cloud Messaging registration token */
  @Column({ type: 'varchar', length: 512 })
  deviceToken: string;

  /** Platform identifier for conditional notification payloads */
  @Column({ type: 'varchar', length: 20, default: 'android' })
  platform: string; // 'android' | 'ios' | 'web'

  /** Optional user-friendly device label (e.g. "Pixel 8 Pro") */
  @Column({ type: 'varchar', length: 255, nullable: true })
  deviceName?: string;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6 })
  updatedAt: Date;
}
