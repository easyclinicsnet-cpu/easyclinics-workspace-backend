import {
  Entity,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { InventoryCategory } from './inventory-category.entity';
import { Supplier } from './supplier.entity';
import { Batch } from './batch.entity';
import { ConsumableMovement } from './consumable-movement.entity';
import { ConsumableUsage } from './consumable-usage.entity';
import { ConsumablePartialUsage } from './consumable-partial-usage.entity';
import { ConsumableAdjustment } from './consumable-adjustment.entity';
import { ItemType } from '../../../common/enums';
import { IStorageConditions, IMaterialComposition } from '../interfaces';
import { SplitUnitDefinition } from '../types';

export enum ConsumableForm {
  SOLID = 'SOLID',
  LIQUID = 'LIQUID',
  GAS = 'GAS',
  SEMI_SOLID = 'SEMI_SOLID',
  POWDER = 'POWDER',
  OTHER = 'OTHER',
}

export enum ConsumableUnit {
  PIECE = 'PIECE',
  BOX = 'BOX',
  CARTON = 'CARTON',
  PACK = 'PACK',
  VIAL = 'VIAL',
  BOTTLE = 'BOTTLE',
  TUBE = 'TUBE',
  SACHET = 'SACHET',
  AMPULE = 'AMPULE',
  BAG = 'BAG',
  ROLL = 'ROLL',
  SHEET = 'SHEET',
  PAIR = 'PAIR',
  DOZEN = 'DOZEN',
  TRAY = 'TRAY',
  KIT = 'KIT',
  SET = 'SET',
  CAN = 'CAN',
  BARREL = 'BARREL',
  LITER = 'LITER',
  MILLILITER = 'MILLILITER',
  GRAM = 'GRAM',
  KILOGRAM = 'KILOGRAM',
  METER = 'METER',
  CENTIMETER = 'CENTIMETER',
  MILLIMETER = 'MILLIMETER',
  OTHER = 'OTHER',
}

/**
 * Consumable Item Entity
 * Represents medical consumables and supplies in inventory
 * Multi-tenant: scoped by workspaceId
 */
@Entity('consumable_items')
@Index('IDX_con_items_workspace', ['workspaceId'])
@Index('IDX_con_items_workspace_code', ['workspaceId', 'code'], {
  unique: true,
})
@Index('IDX_con_items_workspace_name', ['workspaceId', 'name'])
@Index('IDX_con_items_workspace_category', ['workspaceId', 'categoryId'])
export class ConsumableItem extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  workspaceId: string;

  @Column({ type: 'varchar', length: 255 })
  code: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'enum', enum: ItemType, default: ItemType.CONSUMABLE })
  type: ItemType = ItemType.CONSUMABLE;

  @BeforeInsert()
  @BeforeUpdate()
  ensureConsumableType() {
    this.type = ItemType.CONSUMABLE;
  }

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

  @Column({ type: 'enum', enum: ConsumableForm, nullable: true })
  form?: ConsumableForm;

  @Column({ type: 'varchar', length: 255, nullable: true })
  barcode?: string;

  @Column({ type: 'enum', enum: ConsumableUnit, nullable: true })
  unitOfMeasure?: ConsumableUnit;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  unitCost: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  sellingPrice?: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  baseUnitPrice?: number;

  @Column({ type: 'boolean', default: false })
  isSingleUse: boolean;

  @Column({ type: 'boolean', default: false })
  isSterile: boolean;

  @Column({ type: 'boolean', default: false })
  isDisposable: boolean;

  @Column({ type: 'boolean', default: false })
  isReusable: boolean;

  @Column({ type: 'boolean', default: false })
  requiresSterilization: boolean;

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
      to: (value: any) => (value !== undefined && value !== null ? JSON.stringify(value) : null),
      from: (value: string | null) => {
        if (!value) return [];
        try { return JSON.parse(value); } catch { return []; }
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

  @OneToMany(() => Batch, (batch) => batch.consumableItem)
  batches: Batch[];

  @OneToMany(() => ConsumableMovement, (m) => m.consumableItem)
  movements: ConsumableMovement[];

  @OneToMany(() => ConsumableUsage, (u) => u.consumableItem)
  usages: ConsumableUsage[];

  @OneToMany(() => ConsumablePartialUsage, (pu) => pu.consumableItem)
  partialUsages: ConsumablePartialUsage[];

  @OneToMany(() => ConsumableAdjustment, (a) => a.consumableItem)
  adjustments: ConsumableAdjustment[];
}
