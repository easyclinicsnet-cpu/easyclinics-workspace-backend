import {
  Entity,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { InventoryCategory } from './inventory-category.entity';
import { Supplier } from './supplier.entity';
import { Batch } from './batch.entity';
import { MedicationMovement } from './medication-movement.entity';
import { MedicationSale } from './medication-sale.entity';
import { MedicationPartialSale } from './medication-partial-sale.entity';
import { MedicationAdjustment } from './medication-adjustment.entity';
import { ItemType } from '../../../common/enums';
import { IStorageConditions, IMaterialComposition } from '../interfaces';
import { SplitUnitDefinition } from '../types';

export enum MedicationForm {
  SOLID = 'SOLID',
  LIQUID = 'LIQUID',
  GAS = 'GAS',
  SEMI_SOLID = 'SEMI_SOLID',
  POWDER = 'POWDER',
  OTHER = 'OTHER',
}

export enum MedicationUnit {
  TABLET = 'TABLET',
  CAPSULE = 'CAPSULE',
  CAPLET = 'CAPLET',
  PILL = 'PILL',
  LOZENGE = 'LOZENGE',
  SUPPOSITORY = 'SUPPOSITORY',
  ML = 'ML',
  LITER = 'LITER',
  VIAL = 'VIAL',
  AMPULE = 'AMP',
  SYRINGE = 'SYRINGE',
  BOTTLE = 'BOTTLE',
  TUBE = 'TUBE',
  PACK = 'PACK',
  OTHER = 'OTHER',
}

/**
 * Medication Item Entity
 * Represents pharmaceutical medications in inventory
 * Multi-tenant: scoped by workspaceId
 */
@Entity('medication_items')
@Index('IDX_med_items_workspace', ['workspaceId'])
@Index('IDX_med_items_workspace_code', ['workspaceId', 'code'], {
  unique: true,
})
@Index('IDX_med_items_workspace_name', ['workspaceId', 'name'])
@Index('IDX_med_items_workspace_category', ['workspaceId', 'categoryId'])
export class MedicationItem extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  workspaceId: string;

  @Column({ type: 'varchar', length: 255 })
  code: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'enum', enum: ItemType })
  type: ItemType;

  @Column({ type: 'decimal', precision: 14, scale: 4, default: 0 })
  totalQuantity: number;

  @Column({ type: 'decimal', precision: 14, scale: 4, default: 0 })
  availableQuantity: number;

  @Column({ type: 'decimal', precision: 14, scale: 4, default: 0 })
  reservedQuantity: number;

  @Column({ type: 'decimal', precision: 14, scale: 4, default: 0 })
  minimumStockLevel: number;

  @Column({ type: 'decimal', precision: 14, scale: 4, default: 0 })
  reorderQuantity: number;

  @Column({ type: 'decimal', precision: 10, scale: 0, default: 0 })
  totalPackCount: number;

  @Column({ type: 'boolean', default: false })
  trackInBaseUnits: boolean;

  @Column({ type: 'enum', enum: MedicationForm, nullable: true })
  form?: MedicationForm;

  @Column({ type: 'varchar', length: 255, nullable: true })
  barcode?: string;

  @Column({ type: 'enum', enum: MedicationUnit, nullable: true })
  unitOfMeasure?: MedicationUnit;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  unitCost: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  sellingPrice?: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  baseUnitPrice?: number;

  @Column({ type: 'boolean', default: false })
  requiresPrescription: boolean;

  @Column({ type: 'boolean', default: false })
  isControlledSubstance: boolean;

  @Column({ type: 'boolean', default: false })
  isHighRisk: boolean;

  @Column({ type: 'boolean', default: false })
  isSingleUse: boolean;

  @Column({ type: 'boolean', default: false })
  isSterile: boolean;

  @Column({ type: 'boolean', default: false })
  isSplittable: boolean;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  basePackSize?: number;

  @Column({ type: 'varchar', length: 20, nullable: true })
  basePackUnit?: string;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  minimumDispenseQuantity?: number;

  @Column({ type: 'boolean', default: true })
  useOpenedPacksFirst: boolean;

  @Column({
    type: 'longtext',
    nullable: true,
    transformer: {
      to: (value: SplitUnitDefinition[] | undefined | null) => (value !== undefined && value !== null ? JSON.stringify(value) : null),
      from: (value: string | null) => {
        if (!value) return [];
        try { return JSON.parse(value) as SplitUnitDefinition[]; } catch { return []; }
      },
    },
  })
  splitUnits?: SplitUnitDefinition[];

  @Column({
    type: 'longtext',
    nullable: true,
    transformer: {
      to: (value: IMaterialComposition | undefined | null) => (value ? JSON.stringify(value) : null),
      from: (value: string | null) => {
        if (!value) return null;
        try { return JSON.parse(value) as IMaterialComposition; } catch { return null; }
      },
    },
  })
  materialComposition?: IMaterialComposition;

  @Column({
    type: 'longtext',
    nullable: true,
    transformer: {
      to: (value: IStorageConditions | undefined | null) => (value ? JSON.stringify(value) : null),
      from: (value: string | null) => {
        if (!value) return null;
        try { return JSON.parse(value) as IStorageConditions; } catch { return null; }
      },
    },
  })
  storageConditions?: IStorageConditions;

  @Column({
    type: 'longtext',
    nullable: true,
    transformer: {
      to: (value: IStorageConditions | undefined | null) => (value ? JSON.stringify(value) : null),
      from: (value: string | null) => {
        if (!value) return null;
        try { return JSON.parse(value) as IStorageConditions; } catch { return null; }
      },
    },
  })
  storageOverrides?: IStorageConditions;

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

  @Column({ type: 'varchar', length: 255 })
  categoryId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  supplierId?: string;

  @ManyToOne(() => InventoryCategory)
  @JoinColumn({ name: 'categoryId' })
  category: InventoryCategory;

  @ManyToOne(() => Supplier, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'supplierId' })
  supplier?: Supplier;

  @OneToMany(() => Batch, (batch) => batch.medicationItem)
  batches: Batch[];

  @OneToMany(() => MedicationMovement, (m) => m.medicationItem)
  movements: MedicationMovement[];

  @OneToMany(() => MedicationSale, (s) => s.medicationItem)
  sales: MedicationSale[];

  @OneToMany(() => MedicationPartialSale, (ps) => ps.medicationItem)
  partialSales: MedicationPartialSale[];

  @OneToMany(() => MedicationAdjustment, (a) => a.medicationItem)
  adjustments: MedicationAdjustment[];
}
