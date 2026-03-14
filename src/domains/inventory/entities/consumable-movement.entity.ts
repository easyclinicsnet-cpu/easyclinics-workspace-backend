import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { ConsumableItem } from './consumable-item.entity';
import { Batch } from './batch.entity';
import { MovementType } from '../../../common/enums';

/**
 * Consumable Movement Entity
 * Tracks all consumable inventory movements
 * Multi-tenant: scoped by workspaceId
 */
@Entity('consumable_movements')
@Index('IDX_con_movements_workspace', ['workspaceId'])
@Index('IDX_con_movements_workspace_item', ['workspaceId', 'consumableItemId'])
@Index('IDX_con_movements_workspace_type', ['workspaceId', 'movementType'])
export class ConsumableMovement extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  workspaceId: string;

  @Column({ type: 'varchar', length: 255 })
  consumableItemId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  batchId?: string;

  @Column({ type: 'decimal', precision: 10, scale: 4 })
  quantity: number;

  @Column({ type: 'enum', enum: MovementType })
  type: MovementType;

  @Column({ type: 'enum', enum: MovementType })
  movementType: MovementType;

  @Column({ type: 'varchar', length: 255 })
  department: string;

  @Column({ type: 'text', nullable: true })
  reference?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  initiatedBy?: string;

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

  @ManyToOne(() => ConsumableItem, (con) => con.movements)
  @JoinColumn({ name: 'consumableItemId' })
  consumableItem: ConsumableItem;

  @ManyToOne(() => Batch)
  @JoinColumn({ name: 'batchId' })
  batch?: Batch;
}
