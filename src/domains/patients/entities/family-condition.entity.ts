import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Patient } from './patient.entity';

/**
 * Family Condition Entity
 * Tracks hereditary conditions and family medical history
 */
@Entity('family_conditions')
@Index('idx_family_conditions_workspace_id', ['workspaceId'])
@Index('idx_family_conditions_patient_id', ['patientId'])
export class FamilyCondition extends BaseEntity {
  @Column({ type: 'varchar', length: 255, nullable: false })
  workspaceId: string;

  @Column({ type: 'varchar', length: 255, comment: 'Encrypted field' })
  relation: string;

  @Column({ type: 'varchar', length: 255, comment: 'Encrypted field' })
  condition: string;

  @Column({ type: 'text', nullable: true, comment: 'Encrypted field' })
  notes?: string;

  @Column({ type: 'varchar', length: 255, comment: 'Encrypted field' })
  userId: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'patientId' })
  patient: Patient;
}
