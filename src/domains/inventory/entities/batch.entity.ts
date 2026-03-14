import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { MedicationItem } from './medication-item.entity';
import { ConsumableItem } from './consumable-item.entity';
import { Supplier } from './supplier.entity';
import { ItemType } from '../../../common/enums';

/**
 * Batch Entity
 * Tracks inventory batches with expiry, manufacture dates, and quality control
 * Multi-tenant: scoped by workspaceId
 */
@Entity('batches')
@Index('IDX_batches_workspace', ['workspaceId'])
@Index('IDX_batches_workspace_item_type', ['workspaceId', 'itemType'])
@Index('IDX_batches_expiry_date', ['expiryDate'])
@Index('IDX_batches_manufacture_date', ['manufactureDate'])
@Index('IDX_batches_is_active', ['isActive'])
@Index('IDX_batches_is_partial', ['isPartial'])
@Index('IDX_batches_is_sterile', ['isSterile'])
@Index('IDX_batches_parent_batch', ['parentBatchId'])
@Index('IDX_batches_workspace_batch_number', ['workspaceId', 'batchNumber'], {
  unique: true,
})
export class Batch extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  workspaceId: string;

  @Column({ type: 'varchar', length: 255 })
  batchNumber: string;

  @Column({ type: 'enum', enum: ItemType })
  itemType: ItemType;

  @Column({ type: 'date' })
  manufactureDate: Date;

  @Column({ type: 'date' })
  expiryDate: Date;

  @Column({ type: 'decimal', precision: 14, scale: 4 })
  initialQuantity: number;

  @Column({ type: 'decimal', precision: 14, scale: 4 })
  availableQuantity: number;

  @Column({ type: 'decimal', precision: 10, scale: 0, default: 0 })
  totalPacks: number;

  @Column({ type: 'decimal', precision: 10, scale: 0, default: 0 })
  openedPacks: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  packSize?: number;

  @Column({ type: 'varchar', length: 20, nullable: true })
  quantityUnit?: string;

  @Column({ type: 'boolean', default: false })
  isFractionalTracking: boolean;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  unitCost: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  sellingPrice?: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  location?: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ type: 'boolean', default: false })
  isPartial: boolean;

  @Column({ type: 'varchar', length: 50, nullable: true })
  parentBatchId?: string;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  partialQuantity?: number;

  @Column({ type: 'boolean', default: false })
  isSterile: boolean;

  @Column({ type: 'varchar', length: 100, nullable: true })
  sterilityIndicator?: string;

  @Column({ type: 'date', nullable: true })
  sterilityExpiryDate?: Date;

  @Column({ type: 'boolean', default: true })
  isQualityTested: boolean;

  @Column({ type: 'date', nullable: true })
  qualityTestDate?: Date;

  @Column({ type: 'varchar', length: 50, nullable: true })
  qualityTestResult?: string;

  @Column({ type: 'text', nullable: true })
  qualityTestNotes?: string;

  @Column({ type: 'boolean', default: false })
  isQuarantined: boolean;

  @Column({ type: 'decimal', precision: 10, scale: 4, default: 0 })
  reservedQuantity: number;

  @Column({ type: 'text', nullable: true })
  quarantineReason?: string;

  @Column({ type: 'date', nullable: true })
  quarantineDate?: Date;

  @Column({ type: 'varchar', length: 50, nullable: true })
  quarantineReleasedBy?: string;

  @Column({ type: 'date', nullable: true })
  quarantineReleaseDate?: Date;

  @Column({ type: 'varchar', length: 100, nullable: true })
  certificateOfAnalysis?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  manufacturingLicense?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  importPermitNumber?: string;

  @Column({ type: 'date', nullable: true })
  receivedDate?: Date;

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

  @Column({ type: 'varchar', length: 255, nullable: true })
  medicationItemId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  consumableItemId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  supplierId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  createdBy?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  updatedBy?: string;

  @ManyToOne(() => MedicationItem, (med) => med.batches, {
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({ name: 'medicationItemId' })
  medicationItem?: MedicationItem;

  @ManyToOne(() => ConsumableItem, (con) => con.batches, {
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({ name: 'consumableItemId' })
  consumableItem?: ConsumableItem;

  @ManyToOne(() => Supplier, (sup) => sup.batches, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'supplierId' })
  supplier?: Supplier;
}
