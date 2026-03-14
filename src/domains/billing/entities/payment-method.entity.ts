import { Entity, Column } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { PaymentMethodType } from '../../../common/enums';

/**
 * Payment Method Entity
 * Defines available payment methods and their configurations
 */
@Entity('payment_methods')
export class PaymentMethod extends BaseEntity {
  @Column({
    type: 'enum',
    enum: PaymentMethodType,
    default: PaymentMethodType.CASH,
  })
  type: PaymentMethodType;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description?: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  processingFeePercentage?: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  minAmount?: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  maxAmount?: number;

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
  configuration?: any;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  icon?: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  color?: string;

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
