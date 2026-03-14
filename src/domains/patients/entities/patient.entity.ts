import { IsUUID } from 'class-validator';
import {
  Entity,
  Column,
  Index,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { Allergy } from './allergy.entity';
import { Vital } from './vital.entity';
import { SocialHistory } from './social-history.entity';
import { PastMedicalHistory } from './past-medical-history.entity';
import { PastSurgicalHistory } from './past-surgical-history.entity';
import { FamilyCondition } from './family-condition.entity';
import { Appointment } from 'src/domains/appointments/entities/appointment.entity';
import { PatientBill } from 'src/domains/billing/entities';
import { RepeatPrescription, ReferralLetter, SickNote } from 'src/domains/care-notes/entities';
import { Consultation } from 'src/domains/consultations/entities/consultation.entity';
import { PatientInsurance } from 'src/domains/insurance/entities';
import { MedicationPartialSale, ConsumablePartialUsage } from 'src/domains/inventory/entities';

/**
 * Patient Entity - Multi-Tenant
 * Core patient demographic and contact information
 *
 * Multi-Tenancy: Scoped by workspaceId
 * Encryption: Fields marked with 'Encrypted field' comment are encrypted at application level
 */
@Entity('patients')
@Index('idx_patients_workspace', ['workspaceId'])
@Index('idx_patients_workspace_file', ['workspaceId', 'fileNumber'])
@Index('idx_patients_workspace_active', ['workspaceId', 'isActive'])
@Index('idx_patients_file_number', ['fileNumber'])
@Index('idx_patients_external_id', ['externalId'])
@Index('idx_patients_is_active', ['isActive'])
@Index('idx_patients_active_created', ['isActive', 'createdAt'])
@Index('idx_patients_active_updated', ['isActive', 'updatedAt'])
@Index('idx_patients_deleted_at', ['deletedAt'])
@Index('idx_patients_insurance_migrated', ['insuranceMigrated', 'isActive'])
@Index('idx_patients_insurance_migrated_at', ['insuranceMigratedAt'])
export class Patient {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // ===== MULTI-TENANCY =====
  @Column({ type: 'varchar', length: 255, nullable: false })
  @IsUUID()
  workspaceId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  externalId?: string;

  @Column({ type: 'varchar', length: 255, comment: 'Encrypted field' })
  firstName: string;

  @Column({ type: 'varchar', length: 255, comment: 'Encrypted field' })
  lastName: string;

  @Column({ type: 'varchar', length: 255, comment: 'Encrypted field' })
  gender: string;

  @Column({ type: 'varchar', length: 255, comment: 'Encrypted field' })
  birthDate: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: 'Encrypted field' })
  phoneNumber?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: 'Encrypted field' })
  medicalAid?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: 'Encrypted field' })
  membershipNumber?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: 'Encrypted field' })
  fileNumber?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: 'Encrypted field' })
  email?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: 'Encrypted field' })
  city?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: 'Encrypted field' })
  address?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: 'Encrypted field' })
  nationalId?: string;

  // ===== COMPUTED/VIRTUAL FIELDS =====
  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    select: false,
    insert: false,
    update: false,
  })
  age?: string;

  // ===== STATUS FLAGS =====
  @Column({ type: 'boolean', default: true })
  isActive: boolean = true;

  // ===== INSURANCE MIGRATION TRACKING =====
  @Column({ type: 'boolean', default: false })
  insuranceMigrated: boolean = false;

  @Column({ type: 'timestamp', nullable: true })
  insuranceMigratedAt?: Date;

  // ===== AUDIT FIELDS =====
  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamp', nullable: true })
  deletedAt?: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  deletedById?: string;

  // ===== RELATIONSHIPS =====

  // Within patients domain (cascade enabled)
  @OneToMany(() => Allergy, (allergy) => allergy.patient, {
    cascade: true,
  })
  allergies?: Allergy[];

  @OneToMany(() => Vital, (vital) => vital.patient, {
    cascade: true,
  })
  vitals?: Vital[];

  @OneToMany(() => FamilyCondition, (condition) => condition.patient, {
    cascade: true,
  })
  familyConditions?: FamilyCondition[];

  @OneToMany(() => SocialHistory, (history) => history.patient, {
    cascade: true,
  })
  socialHistories?: SocialHistory[];

  @OneToMany(() => PastMedicalHistory, (history) => history.patient, {
    cascade: true,
  })
  medicalHistory?: PastMedicalHistory[];

  @OneToMany(() => PastSurgicalHistory, (history) => history.patient, {
    cascade: true,
  })
  surgicalHistory?: PastSurgicalHistory[];

  
  @OneToMany('Appointment', 'patient')
  appointments?: Appointment[]; 

  @OneToMany('Consultation', 'patient')
  consultations?: Consultation[]; 

  @OneToMany('PatientBill', 'patient')
  patientBills?: PatientBill[]; 

  @OneToMany('MedicationPartialSale', 'patient')
  medicationPartialSales?: MedicationPartialSale[]; 

  @OneToMany('ConsumablePartialUsage', 'patient')
  consumablePartialUsages?: ConsumablePartialUsage[]; 

  @OneToOne('PatientInsurance', 'patient')
  insurance?: PatientInsurance;

  @OneToMany('RepeatPrescription', 'patient', { cascade: true, onDelete: 'CASCADE' })
  repeatPrescriptions?: RepeatPrescription[];

  @OneToMany('ReferralLetter', 'patient', { cascade: true })
  referralLetters?: ReferralLetter[]; 

  @OneToMany('SickNote', 'patient', { cascade: true })
  sickNotes?: SickNote[]; 
}
