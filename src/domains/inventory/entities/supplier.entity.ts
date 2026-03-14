import { Entity, Column, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Batch } from './batch.entity';

/**
 * Supplier Entity
 * Manages supplier information for inventory procurement
 * Multi-tenant: scoped by workspaceId
 */
@Entity('suppliers')
@Index('IDX_suppliers_workspace', ['workspaceId'])
@Index('IDX_suppliers_workspace_code', ['workspaceId', 'code'], { unique: true })
export class Supplier extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  workspaceId: string;

  @Column({ type: 'varchar', length: 255 })
  code: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'varchar', length: 255 })
  contactPerson: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 255 })
  phone: string;

  @Column({ type: 'text' })
  address: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  taxIdentificationNumber?: string;

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
  paymentTerms?: any;

  @OneToMany(() => Batch, (batch) => batch.supplier)
  batches: Batch[];
}
