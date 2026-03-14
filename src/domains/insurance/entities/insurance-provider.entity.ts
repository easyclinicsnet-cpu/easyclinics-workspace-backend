import { Entity, Column, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { InsuranceScheme } from './insurance-scheme.entity';
import { ProviderStatus } from './provider-status.enum';
export { ProviderStatus };  

/**
 * Insurance Provider Entity
 *
 * Represents an insurance company / HMO / payer.
 *
 * Multi-tenancy: GLOBAL — providers are shared across all workspaces.
 *   Facilities reference the same provider records regardless of which
 *   workspace they belong to. Workspace-specific configuration lives in
 *   InsuranceContract (which IS workspace-scoped).
 */
@Entity('insurance_providers')
@Index('IDX_insurance_providers_code', ['providerCode'], { unique: true })
export class InsuranceProvider extends BaseEntity {
  // ── Identity ──────────────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 255 })
  providerCode: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  shortName?: string;

  @Column({
    type: 'enum',
    enum: ProviderStatus,
    default: ProviderStatus.ACTIVE,
  })
  status: ProviderStatus;

  @Column({ type: 'text', nullable: true })
  description?: string;

  // ── Contact ───────────────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 500, nullable: true })
  address?: string;

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
  contactInfo?: any;

  // ── Claims processing ─────────────────────────────────────────────────────

  @Column({ type: 'boolean', default: false })
  requiresPreAuthorization: boolean;

  @Column({ type: 'boolean', default: true })
  supportsElectronicClaims: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  claimsSubmissionFormat?: string;

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
  processingTimes?: any;

  // ── Financial defaults ────────────────────────────────────────────────────

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  defaultCopaymentPercentage: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  minimumClaimAmount?: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  maximumClaimAmount?: number;

  // ── Legacy contract snapshot (deprecated — use InsuranceContract) ─────────

  @Column({ type: 'varchar', length: 255, nullable: true })
  contractNumber?: string;

  @Column({ type: 'date', nullable: true })
  contractStartDate?: Date;

  @Column({ type: 'date', nullable: true })
  contractEndDate?: Date;

  @Column({ type: 'text', nullable: true })
  termsAndConditions?: string;

  // ── Extensibility ─────────────────────────────────────────────────────────

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

  // ── Relations ─────────────────────────────────────────────────────────────

  @OneToMany(() => InsuranceScheme, (scheme) => scheme.provider, { lazy: true })
  schemes: InsuranceScheme[];
}
