import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { IsBoolean, IsEnum } from 'class-validator';
import { Patient } from '../../patients/entities/patient.entity';
import { Appointment } from '../../appointments/entities/appointment.entity';
import { ConsultationCollaborator } from './consultation-collaborator.entity';
import { ConsultationStatus } from '../../../common/enums';
import { ConsultationJoinRequest } from './consultation-join-request.entity';
import { Prescription } from '../../care-notes/entities/prescription.entity';
import { CareNoteTimeline } from '../../care-notes/entities/care-note-timeline.entity';
import { CareNote } from '../../care-notes/entities/care-note.entity';
import { BaseEntity } from 'src/common/entities/base.entity';

/**
 * Consultation Entity - Multi-Tenant
 * Represents a medical consultation session
 *
 * Multi-Tenancy: Explicit workspaceId field + scoped via patient/appointment relationship
 * Business Logic: Moved to ConsultationRepository and ConsultationsService
 */
@Entity('consultations')
@Index('IDX_consultations_workspace', ['workspaceId'])
@Index('IDX_consultations_workspace_patient', ['workspaceId', 'patientId'])
@Index('IDX_consultations_workspace_doctor', ['workspaceId', 'doctorId'])
@Index('IDX_consultations_workspace_status', ['workspaceId', 'status'])
@Index('IDX_consultations_workspace_active', ['workspaceId', 'isActive'])
@Index('IDX_consultations_doctor', ['doctorId'])
@Index('IDX_consultations_status', ['status'])
@Index('IDX_consultations_open_joining', ['isOpenForJoining'])
@Index('IDX_consultations_join_approval', ['requiresJoinApproval'])
@Index('IDX_consultations_patient', ['patientId'])
@Index('IDX_consultations_appointment', ['appointmentId'])
@Index('IDX_consultations_created_at', ['createdAt'])
@Index('IDX_consultations_deleted_at', ['deletedAt'])
export class Consultation extends BaseEntity {
 
  // ===== MULTI-TENANCY =====
  @Column({ type: 'varchar', length: 255, nullable: false })
  workspaceId!: string;

  @Column({ name: 'patientId', nullable: false })
  patientId!: string;

  @ManyToOne(() => Patient, (patient) => patient.consultations)
  @JoinColumn({ name: 'patientId' })
  patient!: Patient;

  @OneToOne(() => Appointment, (appointment) => appointment.consultation, {
    nullable: false,
  })
  @JoinColumn({ name: 'appointmentId' })
  appointment!: Appointment;

  @Column({ name: 'appointmentId', unique: true })
  appointmentId!: string;

  @OneToMany(() => Prescription, (prescription) => prescription.consultation, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  prescriptions!: Prescription[];

  @OneToMany(() => CareNote, (note) => note.consultation, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  notes!: CareNote[];

  @OneToMany(() => CareNoteTimeline, (timeline) => timeline.consultation, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  noteTimelines!: CareNoteTimeline[];

  @Column({ name: 'doctorId' })
  doctorId!: string;

  @Column({
    type: 'enum',
    enum: ConsultationStatus,
    default: ConsultationStatus.DRAFT,
  })
  @IsEnum(ConsultationStatus)
  status!: ConsultationStatus;

  // Joining/Access Control
  @Column({
    name: 'is_open_for_joining',
    default: false,
    comment:
      'When true, allows other practitioners to request joining this consultation',
  })
  @IsBoolean()
  isOpenForJoining: boolean = false;

  @Column({
    name: 'requires_join_approval',
    default: true,
    comment: 'When true, join requests require manual approval',
  })
  @IsBoolean()
  requiresJoinApproval: boolean = true;

  @OneToMany(
    () => ConsultationCollaborator,
    (collaborator) => collaborator.consultation,
  )
  collaborators!: ConsultationCollaborator[];

  @OneToMany(() => ConsultationJoinRequest, (request) => request.consultation)
  joinRequests!: ConsultationJoinRequest[];
}
