import { IsUUID } from 'class-validator';
import {
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Column,
} from 'typeorm';

/**
 * Base entity class with common fields for all entities
 * Provides UUID primary key, timestamps, and soft delete functionality
 */
export abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  @IsUUID()
  id: string;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6 })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'datetime', precision: 6, nullable: true })
  deletedAt?: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  deletedBy?: string;

  @Column({ type: 'boolean', default: false })
  isDeleted: boolean;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;
}
