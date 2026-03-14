import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { InsuranceProvider } from './insurance-provider.entity';
import { ProviderStatus } from './provider-status.enum';

export enum SchemeType {
  HMO       = 'HMO',
  PPO       = 'PPO',
  EPO       = 'EPO',
  POS       = 'POS',
  INDEMNITY = 'INDEMNITY',
  OTHER     = 'OTHER',
}

/**
 * Insurance Scheme Entity
 *
 * Represents a specific insurance plan / product offered by a provider.
 *
 * Multi-tenancy: GLOBAL — schemes are shared across all workspaces.
 *   Multiple facilities can enrol patients under the same scheme.
 *   Workspace-specific pricing / coverage overrides live in InsuranceContract.
 */
@Entity('insurance_schemes')
@Index('IDX_insurance_schemes_code', ['schemeCode'], { unique: true })
@Index('IDX_insurance_schemes_provider', ['providerId'])
export class InsuranceScheme extends BaseEntity {
  // ── Parent provider ───────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 255 })
  providerId: string;

  // ── Identity ──────────────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 255 })
  schemeCode: string;

  @Column({ type: 'varchar', length: 255 })
  schemeName: string;

  @Column({
    type: 'enum',
    enum: SchemeType,
    default: SchemeType.OTHER,
  })
  schemeType: SchemeType;

  @Column({
    type: 'enum',
    enum: ProviderStatus,
    default: ProviderStatus.ACTIVE,
  })
  status: ProviderStatus;

  @Column({ type: 'text', nullable: true })
  description?: string;

  // ── Coverage defaults ─────────────────────────────────────────────────────

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 100 })
  defaultCoveragePercentage: number;

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
  coverageRules?: any;

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
  benefitLimits?: any;

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
  authorizationRequirements?: any;

  @Column({ type: 'boolean', default: false })
  requiresPreAuthorization: boolean;

  // ── Network ───────────────────────────────────────────────────────────────

  @Column({ type: 'boolean', default: false })
  restrictedToNetwork: boolean;

  @Column({ type: 'text', nullable: true })
  networkProviders?: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  outOfNetworkPenalty?: number;

  // ── Financials ────────────────────────────────────────────────────────────

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  monthlyPremium: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  annualDeductible?: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  copaymentAmount?: number;

  // ── Validity ──────────────────────────────────────────────────────────────

  @Column({ type: 'date', nullable: true })
  effectiveDate?: Date;

  @Column({ type: 'date', nullable: true })
  expiryDate?: Date;

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

  @ManyToOne(() => InsuranceProvider, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'providerId' })
  provider: InsuranceProvider;
}
