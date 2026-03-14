import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { ItemType } from '../../../common/enums';

/**
 * Inventory Audit Entity
 * Tracks inventory audit trails and physical stock counts
 * Multi-tenant: scoped by workspaceId
 */
@Entity('inventory_audits')
@Index('IDX_inv_audits_workspace', ['workspaceId'])
@Index('IDX_inv_audits_workspace_item', ['workspaceId', 'itemId'])
@Index('IDX_inv_audits_audit_date', ['auditDate'])
export class InventoryAudit extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  workspaceId: string;

  @Column({ type: 'varchar', length: 255 })
  itemId: string;

  @Column({ type: 'enum', enum: ItemType })
  itemType: ItemType;

  @Column({ type: 'varchar', length: 255, nullable: true })
  batchId?: string;

  @Column({ type: 'decimal', precision: 10, scale: 4 })
  systemQuantity: number;

  @Column({ type: 'decimal', precision: 10, scale: 4 })
  physicalQuantity: number;

  @Column({ type: 'decimal', precision: 10, scale: 4 })
  variance: number;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  auditedBy?: string;

  @Column({ type: 'datetime', precision: 6 })
  auditDate: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  approvedBy?: string;

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
}
