import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { Consultation } from './consultation.entity';
import { CollaborationRole } from '../../../common/enums';
import { BaseEntity } from 'src/common/entities/base.entity';

/**
 * ConsultationCollaborator Entity - Multi-Tenant
 * Join table tracking practitioners collaborating on consultations
 *
 * Multi-Tenancy: Explicit workspaceId field + scoped via Consultation relationship
 */
@Entity('consultation_collaborators')
@Index('IDX_consultation_collaborators_workspace', ['workspaceId'])
@Index('IDX_consultation_collaborators_workspace_consultation', [
  'workspaceId',
  'consultationId',
])
@Index('IDX_consultation_collaborators_workspace_user', [
  'workspaceId',
  'userId',
])
@Index('IDX_consultation_collaborators_workspace_active', [
  'workspaceId',
  'isActive',
])
@Index('IDX_consultation_collaborators_consultation', ['consultationId'])
@Index('IDX_consultation_collaborators_user', ['userId'])
@Index('IDX_consultation_collaborators_consultation_user', [
  'consultationId',
  'userId',
])
@Index('IDX_consultation_collaborators_role', ['role'])
@Index('IDX_consultation_collaborators_active', ['isActive'])
@Index('IDX_consultation_collaborators_deleted_at', ['deletedAt'])
export class ConsultationCollaborator extends BaseEntity {
  // ===== MULTI-TENANCY =====
  @Column({ type: 'varchar', length: 255, nullable: false })
  workspaceId!: string;

  @ManyToOne(() => Consultation, (consultation) => consultation.collaborators)
  @JoinColumn({ name: 'consultationId' })
  consultation!: Consultation;

  @Column()
  consultationId!: string;

  @Column()
  userId!: string;

  @Column({
    type: 'enum',
    enum: CollaborationRole,
    default: CollaborationRole.DOCTOR,
  })
  role!: CollaborationRole;

  @Column({ nullable: true })
  deletedById?: string;

  @Column({ type: 'timestamp', nullable: true })
  lastAccessedAt?: Date;

  @Column({ type: 'boolean', default: true })
  isActive: boolean = true;
}
