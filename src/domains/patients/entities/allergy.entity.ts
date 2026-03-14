import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Patient } from './patient.entity';
import { Severity } from '../../../common/enums';

/**
 * Allergy Entity
 * Tracks patient allergies and their severity
 */
@Entity('allergies')
@Index('idx_allergies_workspace_id', ['workspaceId'])
@Index('idx_allergies_patient_id', ['patientId'])
export class Allergy extends BaseEntity {
  @Column({ type: 'varchar', length: 255, nullable: false })
  workspaceId: string;

  @Column({ type: 'varchar', length: 255, comment: 'Encrypted field' })
  substance: string;

  @Column({ type: 'varchar', length: 255, comment: 'Encrypted field' })
  reaction: string;

  @Column({
    type: 'enum',
    enum: Severity,
  })
  severity: Severity;

  @Column({ type: 'varchar', length: 255, comment: 'Encrypted field' })
  userId: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'patientId' })
  patient: Patient;
}
