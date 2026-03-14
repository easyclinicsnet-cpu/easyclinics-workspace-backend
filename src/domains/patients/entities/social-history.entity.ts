import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Patient } from './patient.entity';
import { SmokingStatus, AlcoholUse, DrugUse } from '../../../common/enums';

/**
 * Social History Entity
 * Tracks patient's social and lifestyle information
 */
@Entity('social_history')
@Index('idx_social_history_workspace_id', ['workspaceId'])
@Index('idx_social_history_patient_id', ['patientId'])
export class SocialHistory extends BaseEntity {
  @Column({ type: 'varchar', length: 255, nullable: false })
  workspaceId: string;

  @Column({
    type: 'enum',
    enum: SmokingStatus,
    default: SmokingStatus.NEVER,
  })
  smokingStatus: SmokingStatus;

  @Column({
    type: 'enum',
    enum: AlcoholUse,
    default: AlcoholUse.NEVER,
  })
  alcoholUse: AlcoholUse;

  @Column({
    type: 'enum',
    enum: DrugUse,
    default: DrugUse.NEVER,
  })
  drugUse: DrugUse;

  @Column({ type: 'text', nullable: true, comment: 'Encrypted field' })
  occupation?: string;

  @Column({ type: 'text', nullable: true, comment: 'Encrypted field' })
  additionalNotes?: string;

  @Column({ type: 'varchar', length: 255, comment: 'Encrypted field' })
  userId: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'patientId' })
  patient: Patient;
}
