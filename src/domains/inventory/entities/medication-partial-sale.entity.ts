import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { MedicationItem } from './medication-item.entity';
import { Batch } from './batch.entity';

/**
 * Medication Partial Sale Entity
 * Tracks partial medication sales when full packs are broken down
 * Multi-tenant: scoped by workspaceId
 */
@Entity('medication_partial_sales')
@Index('IDX_med_partial_sales_workspace', ['workspaceId'])
@Index('IDX_med_partial_sales_workspace_item', ['workspaceId', 'medicationItemId'])
@Index('IDX_med_partial_sales_workspace_patient', ['workspaceId', 'patientId'])
export class MedicationPartialSale extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  workspaceId: string;

  @Column({ type: 'varchar', length: 255 })
  medicationItemId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  batchId?: string;

  @Column({ type: 'decimal', precision: 10, scale: 4 })
  quantity: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  packSize?: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  partialQuantity?: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  unitPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalPrice: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  patientId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  prescriptionId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  soldBy?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  billId?: string;

  @Column({ type: 'datetime', precision: 6 })
  saleDate: Date;

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

  @ManyToOne(() => MedicationItem, (med) => med.partialSales)
  @JoinColumn({ name: 'medicationItemId' })
  medicationItem: MedicationItem;

  @ManyToOne(() => Batch)
  @JoinColumn({ name: 'batchId' })
  batch?: Batch;
}
