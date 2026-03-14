import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { ConsumableItem } from './consumable-item.entity';
import { Batch } from './batch.entity';

/**
 * Consumable Partial Usage Entity
 * Tracks partial consumable usage when full packs are broken down
 * Multi-tenant: scoped by workspaceId
 */
@Entity('consumable_partial_usages')
@Index('IDX_con_partial_usages_workspace', ['workspaceId'])
@Index('IDX_con_partial_usages_workspace_item', [
  'workspaceId',
  'consumableItemId',
])
@Index('IDX_con_partial_usages_workspace_patient', ['workspaceId', 'patientId'])
export class ConsumablePartialUsage extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  workspaceId: string;

  @Column({ type: 'varchar', length: 255 })
  consumableItemId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  batchId?: string;

  @Column({ type: 'decimal', precision: 10, scale: 4 })
  quantity: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  packSize?: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  partialQuantity?: number;

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

  @ManyToOne(() => ConsumableItem, (con) => con.partialUsages)
  @JoinColumn({ name: 'consumableItemId' })
  consumableItem: ConsumableItem;

  @ManyToOne(() => Batch)
  @JoinColumn({ name: 'batchId' })
  batch?: Batch;
}
