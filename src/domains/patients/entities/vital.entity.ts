import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Patient } from './patient.entity';

/**
 * Vitals Entity
 * Stores patient vital signs measurements
 */
@Entity('vitals')
@Index('idx_vitals_workspace_id', ['workspaceId'])
@Index('idx_vitals_patient_id', ['patientId'])
export class Vital extends BaseEntity {
  @Column({ type: 'varchar', length: 255, nullable: false })
  workspaceId: string;

  @Column({ type: 'varchar', length: 255, comment: 'Encrypted field - Temperature in Celsius' })
  temperature: string;

  @Column({ type: 'varchar', length: 255, comment: 'Encrypted field - Blood pressure (systolic/diastolic)' })
  bloodPressure: string;

  @Column({ type: 'varchar', length: 255, comment: 'Encrypted field - Heart rate in BPM' })
  heartRate: string;

  @Column({ type: 'varchar', length: 255, comment: 'Encrypted field - Oxygen saturation percentage' })
  saturation: string;

  @Column({ type: 'varchar', length: 255, comment: 'Encrypted field - Glasgow Coma Scale score' })
  gcs: string;

  @Column({ type: 'varchar', length: 255, comment: 'Encrypted field - Blood glucose in mg/dL' })
  bloodGlucose: string;

  @Column({ type: 'varchar', length: 255, comment: 'Encrypted field - Height in centimeters' })
  height: string;

  @Column({ type: 'varchar', length: 255, comment: 'Encrypted field - Weight in kilograms' })
  weight: string;

  @Column({ type: 'time', default: () => 'CURRENT_TIMESTAMP' })
  time: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  appointmentId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  patientId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  consultationId?: string;

  @Column({ type: 'varchar', length: 255 })
  userId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  deletedById?: string;

  @ManyToOne(() => Patient)
  @JoinColumn({ name: 'patientId' })
  patient: Patient;
}
