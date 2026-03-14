import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { ConsumableItem } from './consumable-item.entity';
import { Batch } from './batch.entity';
import { AdjustmentType } from '../../../common/enums';

/**
 * Consumable Adjustment Entity
 * Tracks adjustments to consumable inventory
 * Multi-tenant: scoped by workspaceId
 */
@Entity('consumable_adjustments')
@Index('IDX_con_adjustments_workspace', ['workspaceId'])
@Index('IDX_con_adjustments_workspace_item', [
  'workspaceId',
  'consumableItemId',
])
export class ConsumableAdjustment extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  workspaceId: string;

  @Column({ type: 'varchar', length: 255 })
  consumableItemId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  batchId?: string;

  @Column({ type: 'decimal', precision: 10, scale: 4 })
  quantity: number;

  @Column({ type: 'enum', enum: AdjustmentType })
  adjustmentType: AdjustmentType;

  @Column({ type: 'text', nullable: true })
  reason?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  approvedBy?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  initiatedBy?: string;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  approvalDate?: Date;

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

  @ManyToOne(() => ConsumableItem, (con) => con.adjustments)
  @JoinColumn({ name: 'consumableItemId' })
  consumableItem: ConsumableItem;

  @ManyToOne(() => Batch)
  @JoinColumn({ name: 'batchId' })
  batch?: Batch;
}
