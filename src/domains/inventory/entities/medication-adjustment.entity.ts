import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { MedicationItem } from './medication-item.entity';
import { Batch } from './batch.entity';
import { AdjustmentType } from '../../../common/enums';

/**
 * Medication Adjustment Entity
 * Tracks adjustments to medication inventory
 * Multi-tenant: scoped by workspaceId
 */
@Entity('medication_adjustments')
@Index('IDX_med_adjustments_workspace', ['workspaceId'])
@Index('IDX_med_adjustments_workspace_item', ['workspaceId', 'medicationItemId'])
export class MedicationAdjustment extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  workspaceId: string;

  @Column({ type: 'varchar', length: 255 })
  medicationItemId: string;

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

  @ManyToOne(() => MedicationItem, (med) => med.adjustments)
  @JoinColumn({ name: 'medicationItemId' })
  medicationItem: MedicationItem;

  @ManyToOne(() => Batch)
  @JoinColumn({ name: 'batchId' })
  batch?: Batch;
}
