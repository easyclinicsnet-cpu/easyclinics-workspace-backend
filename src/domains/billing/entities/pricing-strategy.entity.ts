import { Entity, Column } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

/**
 * Pricing Strategy Entity
 * Defines pricing rules and strategies for services and items
 */
@Entity('pricing_strategies')
export class PricingStrategy extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description?: string;

  @Column({ type: 'varchar', length: 50 })
  strategyType: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  serviceType?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  department?: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  basePrice?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  markupPercentage?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  discountPercentage?: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  minPrice?: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  maxPrice?: number;

  @Column({ type: 'int', default: 0 })
  priority: number;

  @Column({ type: 'datetime', nullable: true })
  validFrom?: Date;

  @Column({ type: 'datetime', nullable: true })
  validUntil?: Date;

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
  conditions?: any;

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
  pricingRules?: any;

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
