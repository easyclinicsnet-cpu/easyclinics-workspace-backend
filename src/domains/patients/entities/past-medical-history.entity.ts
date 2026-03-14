import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Patient } from './patient.entity';

/**
 * Past Medical History Entity
 * Stores patient's previous medical conditions
 */
@Entity('past_medical_history')
@Index('idx_past_medical_history_workspace_id', ['workspaceId'])
@Index('idx_past_medical_history_patient_id', ['patientId'])
export class PastMedicalHistory extends BaseEntity {
  @Column({ type: 'varchar', length: 255, nullable: false })
  workspaceId: string;

  @Column({ type: 'varchar', length: 255, comment: 'Encrypted field' })
  condition: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: 'Encrypted field' })
  details?: string;

  @Column({ type: 'varchar', length: 255, comment: 'Encrypted field' })
  userId: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'patientId' })
  patient: Patient;
}
