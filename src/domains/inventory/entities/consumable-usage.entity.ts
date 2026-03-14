import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { ConsumableItem } from './consumable-item.entity';
import { Batch } from './batch.entity';

/**
 * Consumable Usage Entity
 * Tracks consumable item usage in medical procedures and services
 * Multi-tenant: scoped by workspaceId
 */
@Entity('consumable_usages')
@Index('IDX_con_usages_workspace', ['workspaceId'])
@Index('IDX_con_usages_workspace_item', ['workspaceId', 'consumableItemId'])
@Index('IDX_con_usages_workspace_patient', ['workspaceId', 'patientId'])
@Index('IDX_con_usages_usage_date', ['usageDate'])
export class ConsumableUsage extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  workspaceId: string;

  @Column({ type: 'varchar', length: 255 })
  consumableItemId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  batchId?: string;

  @Column({ type: 'decimal', precision: 10, scale: 4 })
  quantity: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  patientId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  procedureId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  serviceId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  usedBy?: string;

  @Column({ type: 'varchar', length: 255 })
  department: string;

  @Column({ type: 'datetime', precision: 6 })
  usageDate: Date;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  // ====================
  // Metadata
  // ====================
  @Column({
    type: 'longtext',
    nullable: true,
    transformer: {
      to: (value: any) => (value ? JSON.stringify(value) : null),
      from: (value: string | null) => {
        if (!value) return null;
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      },
    },
  })
  metadata?: Record<string, any>;

  @ManyToOne(() => ConsumableItem, (con) => con.usages)
  @JoinColumn({ name: 'consumableItemId' })
  consumableItem: ConsumableItem;

  @ManyToOne(() => Batch)
  @JoinColumn({ name: 'batchId' })
  batch?: Batch;
}
