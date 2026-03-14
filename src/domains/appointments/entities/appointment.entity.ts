import { Entity, Column, ManyToOne, OneToOne, OneToMany, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Patient } from '../../patients/entities/patient.entity';
import { Consultation } from '../../consultations/entities/consultation.entity';
import { PatientBill } from '../../billing/entities/patient-bill.entity';
import { ConsumablePartialUsage } from '../../inventory/entities/consumable-partial-usage.entity';
import { MedicationPartialSale } from '../../inventory/entities/medication-partial-sale.entity';
import { AppointmentStatus, AppointmentType } from '../../../common/enums';
import { IsUUID } from 'class-validator';

/**
 * Appointment Entity - Multi-Tenant
 * Manages patient appointments and scheduling
 *
 * Multi-Tenancy: Scoped by workspaceId
 * Encryption: transcriptionId may contain sensitive data
 *
 * Relations:
 * - Patient (ManyToOne): The patient for this appointment
 * - Consultation (OneToOne): Associated consultation session
 * - PatientBill (OneToOne): Billing information
 * - ConsumablePartialUsages (OneToMany): Consumables used during appointment
 * - MedicationPartialSales (OneToMany): Medications sold during appointment
 */
@Entity('appointments')
@Index('IDX_appointments_workspace', ['workspaceId'])
@Index('IDX_appointments_workspace_patient', ['workspaceId', 'patientId'])
@Index('IDX_appointments_workspace_date', ['workspaceId', 'date'])
@Index('IDX_appointments_workspace_status', ['workspaceId', 'status'])
@Index('IDX_appointments_workspace_active', ['workspaceId', 'isActive'])
@Index('IDX_appointments_patient', ['patientId'])
@Index('IDX_appointments_consultation', ['consultationId'])
@Index('IDX_appointments_date', ['date'])
@Index('IDX_appointments_status', ['status'])
@Index('IDX_appointments_user', ['userId'])
export class Appointment extends BaseEntity {
  // ===== MULTI-TENANCY =====
  @Column({ type: 'varchar', length: 255, nullable: false })
  @IsUUID()
  workspaceId!: string;

  // ===== CORE FIELDS =====
  @Column({ type: 'varchar', length: 255, nullable: false })
  patientId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  consultationId?: string;

  @Column({
    type: 'enum',
    enum: AppointmentType,
    default: AppointmentType.INITIAL,
  })
  type!: AppointmentType;

  @Column({ type: 'date' })
  date!: Date;

  @Column({ type: 'varchar', length: 255 })
  time!: string;

  @Column({ type: 'varchar', length: 255 })
  paymentMethod!: string;

  @Column({
    type: 'enum',
    enum: AppointmentStatus,
    default: AppointmentStatus.SCHEDULED,
  })
  status!: AppointmentStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  transcriptionId?: string;

  @Column({ type: 'varchar', length: 255 })
  userId!: string;

  // ===== RELATIONSHIPS =====

  /**
   * Patient relationship
   * ManyToOne: Many appointments belong to one patient
   */
  @ManyToOne(() => Patient, (patient) => patient.appointments)
  @JoinColumn({ name: 'patientId' })
  patient?: Patient;

  /**
   * Consultation relationship
   * OneToOne: One appointment has one consultation
   * Bidirectional: Consultation.appointment
   */
  @OneToOne(() => Consultation, (consultation) => consultation.appointment, {
    nullable: true,
  })
  consultation?: Consultation;

  /**
   * Patient Bill relationship
   * OneToOne: One appointment has one bill
   * Cascade: Bill is saved/updated with appointment
   */
  @OneToOne(() => PatientBill, (bill) => bill.appointment, {
    nullable: true,
  })
  patientBill?: PatientBill;

  /**
   * Consumable Partial Usages relationship
   * OneToMany: One appointment can have many consumable usages
   * Tracks consumable items used during the appointment
   */
  @OneToMany('ConsumablePartialUsage', 'appointment', {
    cascade: true,
    onDelete: 'SET NULL',
  })
  consumablePartialUsages?: ConsumablePartialUsage[];

  /**
   * Medication Partial Sales relationship
   * OneToMany: One appointment can have many medication sales
   * Tracks medications sold/dispensed during the appointment
   */
  @OneToMany('MedicationPartialSale', 'appointment', {
    cascade: true,
    onDelete: 'SET NULL',
  })
  medicationPartialSales?: MedicationPartialSale[];

  // ===== METHODS =====

  /**
   * Check if appointment has a linked consultation
   */
  hasConsultation(): boolean {
    return !!this.consultationId;
  }

  /**
   * Check if appointment is in the past
   */
  isPast(): boolean {
    const appointmentDate = new Date(this.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return appointmentDate < today;
  }

  /**
   * Check if appointment is today
   */
  isToday(): boolean {
    const appointmentDate = new Date(this.date);
    const today = new Date();
    return (
      appointmentDate.getDate() === today.getDate() &&
      appointmentDate.getMonth() === today.getMonth() &&
      appointmentDate.getFullYear() === today.getFullYear()
    );
  }

  /**
   * Check if appointment can be cancelled
   */
  canBeCancelled(): boolean {
    return (
      this.status === AppointmentStatus.SCHEDULED &&
      this.isActive &&
      !this.isPast()
    );
  }

  /**
   * Check if appointment can be completed
   */
  canBeCompleted(): boolean {
    return (
      this.status === AppointmentStatus.IN_PROGRESS ||
      (this.status === AppointmentStatus.SCHEDULED && this.isToday())
    );
  }
}
