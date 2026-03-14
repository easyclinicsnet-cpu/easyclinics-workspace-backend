import { Entity, Column, ManyToOne, JoinColumn, Index, OneToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Patient } from '../../patients/entities/patient.entity';
import { InsuranceProvider, ProviderStatus } from './insurance-provider.entity';
import { InsuranceScheme } from './insurance-scheme.entity';

export enum MemberType {
  PRINCIPAL = 'PRINCIPAL',
  DEPENDENT = 'DEPENDENT',
}

/**
 * Patient Insurance Entity
 *
 * Links a patient to their insurance coverage (provider + scheme).
 * One patient may have one active insurance record per workspace.
 *
 * Multi-tenancy: WORKSPACE-SCOPED.
 *   The composite unique index (workspaceId, patientId) ensures each
 *   patient has at most one insurance enrolment per workspace, while
 *   still allowing the same patient to be enrolled in different workspaces.
 */
@Entity('patient_insurance')
@Index('IDX_patient_insurance_workspace',                            ['workspaceId'])
@Index('IDX_patient_insurance_workspace_patient',  ['workspaceId', 'patientId'], { unique: true })
@Index('IDX_patient_insurance_workspace_provider', ['workspaceId', 'insuranceProviderId'])
export class PatientInsurance extends BaseEntity {
  // ── Multi-tenancy ─────────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 255 })
  workspaceId: string;

  // ── Foreign keys ──────────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 255 })
  patientId: string;

  @Column({ type: 'varchar', length: 255 })
  insuranceProviderId: string;

  @Column({ type: 'varchar', length: 255 })
  schemeId: string;

  // ── Membership ────────────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 255 })
  membershipNumber: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  policyNumber?: string;

  @Column({
    type: 'enum',
    enum: MemberType,
    default: MemberType.PRINCIPAL,
  })
  memberType: MemberType;

  @Column({ type: 'varchar', length: 255, nullable: true })
  principalMemberId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  relationshipToPrincipal?: string;

  @Column({
    type: 'enum',
    enum: ProviderStatus,
    default: ProviderStatus.ACTIVE,
  })
  status: ProviderStatus;

  // ── Coverage priority ─────────────────────────────────────────────────────

  @Column({ type: 'boolean', default: true })
  isPrimary: boolean;

  @Column({ type: 'int', default: 1 })
  priority: number;

  // ── Validity dates ────────────────────────────────────────────────────────

  @Column({ type: 'date' })
  effectiveDate: Date;

  @Column({ type: 'date' })
  expiryDate: Date;

  @Column({ type: 'datetime', nullable: true })
  enrollmentDate?: Date;

  // ── Authorisation ─────────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 255, nullable: true })
  currentAuthorizationNumber?: string;

  @Column({ type: 'date', nullable: true })
  authorizationExpiryDate?: Date;

  @Column({ type: 'text', nullable: true })
  authorizationNotes?: string;

  // ── Utilisation tracking ──────────────────────────────────────────────────

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
  currentYearUtilization?: any;

  // ── Insurance contact ─────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 255, nullable: true })
  insuranceContactPerson?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  insuranceContactPhone?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  insuranceContactEmail?: string;

  // ── Verification ──────────────────────────────────────────────────────────

  @Column({ type: 'date', nullable: true })
  lastVerifiedDate?: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  verifiedBy?: string;

  @Column({ type: 'text', nullable: true })
  verificationNotes?: string;

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

  @OneToOne(() => Patient)
  @JoinColumn({ name: 'patientId' })
  patient: Patient;

  @ManyToOne(() => InsuranceProvider)
  @JoinColumn({ name: 'insuranceProviderId' })
  insuranceProvider: InsuranceProvider;

  @ManyToOne(() => InsuranceScheme)
  @JoinColumn({ name: 'schemeId' })
  scheme: InsuranceScheme;
}
