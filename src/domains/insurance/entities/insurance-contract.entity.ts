import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { InsuranceProvider, ProviderStatus } from './insurance-provider.entity';
import { InsuranceScheme } from './insurance-scheme.entity';

export enum ContractType {
  STANDARD        = 'STANDARD',
  CORPORATE       = 'CORPORATE',
  GOVERNMENT      = 'GOVERNMENT',
  INDIVIDUAL      = 'INDIVIDUAL',
  GROUP           = 'GROUP',
  CAPITATION      = 'CAPITATION',
  FEE_FOR_SERVICE = 'FEE_FOR_SERVICE',
  OTHER           = 'OTHER',
}

export enum PaymentTerms {
  IMMEDIATE = 'IMMEDIATE',
  NET_7     = 'NET_7',
  NET_15    = 'NET_15',
  NET_30    = 'NET_30',
  NET_45    = 'NET_45',
  NET_60    = 'NET_60',
  NET_90    = 'NET_90',
  CUSTOM    = 'CUSTOM',
}

/**
 * Insurance Contract Entity
 *
 * Represents a negotiated agreement between a facility (workspace) and an
 * insurance provider — defining rates, coverage rules, and payment terms.
 *
 * Multi-tenancy: WORKSPACE-SCOPED.
 *   Each workspace negotiates its own contracts with providers.
 *   The composite unique index (workspaceId, contractNumber) ensures
 *   contract numbers are unique per facility, not globally.
 */
@Entity('insurance_contracts')
@Index('IDX_insurance_contracts_workspace',                             ['workspaceId'])
@Index('IDX_insurance_contracts_workspace_number',  ['workspaceId', 'contractNumber'], { unique: true })
@Index('IDX_insurance_contracts_workspace_provider', ['workspaceId', 'insuranceProviderId'])
export class InsuranceContract extends BaseEntity {
  // ── Multi-tenancy ─────────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 255 })
  workspaceId: string;

  // ── Identity ──────────────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 255 })
  contractNumber: string;

  @Column({ type: 'varchar', length: 255 })
  insuranceProviderId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  schemeId?: string;

  @Column({ type: 'varchar', length: 255 })
  contractName: string;

  @Column({
    type: 'enum',
    enum: ContractType,
    default: ContractType.STANDARD,
  })
  contractType: ContractType;

  @Column({
    type: 'enum',
    enum: ProviderStatus,
    default: ProviderStatus.ACTIVE,
  })
  status: ProviderStatus;

  // ── Term dates ────────────────────────────────────────────────────────────

  @Column({ type: 'date' })
  startDate: Date;

  @Column({ type: 'date' })
  endDate: Date;

  @Column({ type: 'date', nullable: true })
  signedDate?: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  signedBy?: string;

  // ── Renewal ───────────────────────────────────────────────────────────────

  @Column({ type: 'boolean', default: true })
  autoRenew: boolean;

  @Column({ type: 'int', nullable: true })
  renewalPeriodDays?: number;

  @Column({ type: 'date', nullable: true })
  noticeDate?: Date;

  @Column({ type: 'int', nullable: true })
  noticePeriodDays?: number;

  // ── Terms & coverage ──────────────────────────────────────────────────────

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'text', nullable: true })
  termsAndConditions?: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  defaultCoveragePercentage?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  discountPercentage?: number;

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
  coverageDetails?: any;

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
  exclusions?: any;

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
  serviceRates?: any;

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

  // ── Payment terms ─────────────────────────────────────────────────────────

  @Column({
    type: 'enum',
    enum: PaymentTerms,
    default: PaymentTerms.NET_30,
  })
  paymentTerms: PaymentTerms;

  @Column({ type: 'int', nullable: true })
  customPaymentDays?: number;

  // ── Financial limits ──────────────────────────────────────────────────────

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  minimumClaimAmount?: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  maximumClaimAmount?: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  annualContractValue?: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  monthlyCapitationAmount?: number;

  @Column({ type: 'int', nullable: true })
  estimatedEnrollees?: number;

  // ── Authorisation & claims ────────────────────────────────────────────────

  @Column({ type: 'boolean', default: false })
  requiresPreAuthorization: boolean;

  @Column({ type: 'int', nullable: true })
  preAuthorizationValidityDays?: number;

  @Column({ type: 'boolean', default: true })
  supportsElectronicClaims: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  claimsSubmissionFormat?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  claimsSubmissionEmail?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  claimsSubmissionUrl?: string;

  @Column({ type: 'int', nullable: true })
  claimProcessingDays?: number;

  // ── Contacts ──────────────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 255, nullable: true })
  contactPerson?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  contactEmail?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  contactPhone?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  billingContactPerson?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  billingContactEmail?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  billingContactPhone?: string;

  // ── Other clauses ─────────────────────────────────────────────────────────

  @Column({ type: 'text', nullable: true })
  specialProvisions?: string;

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
  performanceMetrics?: any;

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
  penaltyClause?: any;

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
  documentReferences?: any;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  // ── Audit ─────────────────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 255, nullable: true })
  createdByUserId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  approvedBy?: string;

  @Column({ type: 'datetime', nullable: true })
  approvedDate?: Date;

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
  @JoinColumn({ name: 'insuranceProviderId' })
  insuranceProvider: InsuranceProvider;

  @ManyToOne(() => InsuranceScheme, { nullable: true })
  @JoinColumn({ name: 'schemeId' })
  scheme?: InsuranceScheme;
}
