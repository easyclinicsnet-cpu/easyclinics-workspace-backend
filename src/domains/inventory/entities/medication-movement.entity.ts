import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { MedicationItem } from './medication-item.entity';
import { Batch } from './batch.entity';
import { MovementType } from '../../../common/enums';

/**
 * Medication Movement Entity
 * Tracks all medication inventory movements
 * Multi-tenant: scoped by workspaceId
 */
@Entity('medication_movements')
@Index('IDX_med_movements_workspace', ['workspaceId'])
@Index('IDX_med_movements_workspace_item', ['workspaceId', 'medicationItemId'])
@Index('IDX_med_movements_workspace_type', ['workspaceId', 'movementType'])
export class MedicationMovement extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  workspaceId: string;

  @Column({ type: 'varchar', length: 255 })
  medicationItemId: string;

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

  @ManyToOne(() => MedicationItem, (med) => med.movements)
  @JoinColumn({ name: 'medicationItemId' })
  medicationItem: MedicationItem;

  @ManyToOne(() => Batch)
  @JoinColumn({ name: 'batchId' })
  batch?: Batch;
}
