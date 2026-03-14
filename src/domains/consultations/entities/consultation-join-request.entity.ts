import { IsUUID } from 'class-validator';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Consultation } from './consultation.entity';
import { CollaborationRole, RequestStatus } from '../../../common/enums';
import { BaseEntity } from 'src/common/entities/base.entity';

/**
 * ConsultationJoinRequest Entity - Multi-Tenant
 * Tracks requests for practitioners to join consultations
 *
 * Multi-Tenancy: Explicit workspaceId field + scoped via Consultation relationship
 */
@Entity('consultation_join_requests')
@Index('IDX_consultation_join_requests_workspace', ['workspaceId'])
@Index('IDX_consultation_join_requests_workspace_consultation', ['workspaceId', 'consultationId'])
@Index('IDX_consultation_join_requests_workspace_user', ['workspaceId', 'requestingUserId'])
@Index('IDX_consultation_join_requests_workspace_status', ['workspaceId', 'status'])
@Index('IDX_consultation_join_requests_consultation', ['consultationId'])
@Index('IDX_consultation_join_requests_user', ['requestingUserId'])
@Index('IDX_consultation_join_requests_status', ['status'])
@Index('IDX_consultation_join_requests_consultation_user', ['consultationId', 'requestingUserId'])
@Index('IDX_consultation_join_requests_created_at', ['createdAt'])
export class ConsultationJoinRequest extends BaseEntity {
  
  // ===== MULTI-TENANCY =====
  @Column({ type: 'varchar', length: 255, nullable: false })
  @IsUUID()
  workspaceId!: string;

  @ManyToOne(() => Consultation, (consultation) => consultation.joinRequests)
  @JoinColumn({ name: 'consultationId' })
  consultation!: Consultation;

  @Column({ name: 'consultationId' })
  consultationId!: string;

  @Column({ name: 'requestingUserId' })
  requestingUserId!: string;

  @Column({
    type: 'enum',
    enum: CollaborationRole,
    default: CollaborationRole.READ_ONLY,
  })
  role: CollaborationRole = CollaborationRole.READ_ONLY;

  @Column({
    type: 'enum',
    enum: RequestStatus,
    default: RequestStatus.PENDING,
  })
  status: RequestStatus = RequestStatus.PENDING;

  @Column({ name: 'processedBy', nullable: true })
  processedBy?: string;

  @Column({
    name: 'processedAt',
    type: 'timestamp',
    nullable: true,
  })
  processedAt?: Date;
}
