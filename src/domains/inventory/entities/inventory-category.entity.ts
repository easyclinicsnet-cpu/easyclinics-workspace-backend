import { Entity, Column, Index, Tree, TreeChildren, TreeParent } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { ItemType } from '../../../common/enums';
import { IStorageConditions } from '../interfaces';

/**
 * Inventory Category Entity
 * Hierarchical categorization for medications and consumables
 * Multi-tenant: scoped by workspaceId
 */
@Entity('inventory_categories')
@Tree('materialized-path')
@Index('IDX_inv_categories_workspace', ['workspaceId'])
@Index('IDX_inv_categories_workspace_code', ['workspaceId', 'code'], { unique: true })
@Index('IDX_inv_categories_name', ['name'])
export class InventoryCategory extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  workspaceId: string;

  @Column({ type: 'varchar', length: 255 })
  code: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  defaultUnit?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  parentId?: string;

  @Column({
    type: 'enum',
    enum: ItemType,
    default: ItemType.MEDICATION,
  })
  type: ItemType;

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

  @Column({ type: 'boolean', default: false })
  requiresPrescriptionDefault: boolean;

  @Column({ type: 'boolean', default: false })
  isControlledDefault: boolean;

  @TreeChildren()
  children: InventoryCategory[];

  @TreeParent()
  parent: InventoryCategory;
}
