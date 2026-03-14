import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConsultationStatus, CollaborationRole } from '../../../common/enums';
import { Consultation } from '../entities/consultation.entity';
import { Patient } from '../../patients/entities/patient.entity';
import { Appointment } from '../../appointments/entities/appointment.entity';
import { Prescription } from '../../care-notes/entities/prescription.entity';
import { CareNote } from '../../care-notes/entities/care-note.entity';
import { CareNoteTimeline } from '../../care-notes/entities/care-note-timeline.entity';
import { ConsultationCollaborator } from '../entities/consultation-collaborator.entity';
import { ConsultationJoinRequest } from '../entities/consultation-join-request.entity';

/**
 * DTO for consultation response with computed fields
 */
export class ConsultationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  patientId!: string;

  @ApiProperty()
  appointmentId!: string;

  @ApiProperty()
  doctorId!: string;

  @ApiProperty({ enum: ConsultationStatus })
  status!: ConsultationStatus;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  isOpenForJoining!: boolean;

  @ApiProperty()
  requiresJoinApproval!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiPropertyOptional()
  deletedAt?: Date;

  @ApiPropertyOptional()
  deletedBy?: string;

  // Nested relations (optional)
  @ApiPropertyOptional({ type: () => Patient })
  patient?: Patient;

  @ApiPropertyOptional({ type: () => Appointment })
  appointment?: Appointment;

  @ApiPropertyOptional({ type: () => [Prescription] })
  prescriptions?: Prescription[];

  @ApiPropertyOptional({ type: () => [CareNote] })
  notes?: CareNote[];

  @ApiPropertyOptional({ type: () => [CareNoteTimeline] })
  noteTimelines?: CareNoteTimeline[];

  @ApiPropertyOptional({ type: () => [ConsultationCollaborator] })
  collaborators?: ConsultationCollaborator[];

  @ApiPropertyOptional({ type: () => [ConsultationJoinRequest] })
  joinRequests?: ConsultationJoinRequest[];

  // Computed fields
  @ApiProperty({ description: 'Whether consultation has any care notes' })
  hasCareNotes: boolean = false;

  @ApiProperty({ description: 'Whether the current user is a collaborator' })
  isUserCollaborator!: boolean;

  @ApiPropertyOptional({
    enum: CollaborationRole,
    description: 'Current user\'s collaboration role',
  })
  userRole!: CollaborationRole | null;

  /**
   * Create response DTO from entity with computed fields
   * @param entity Consultation entity
   * @param userId Optional user ID to compute user-specific fields
   * @returns ConsultationResponseDto
   */
  static fromEntity(
    entity: Consultation,
    userId?: string,
  ): ConsultationResponseDto {
    const dto = new ConsultationResponseDto();

    dto.id = entity.id;
    dto.patientId = entity.patientId;
    dto.appointmentId = entity.appointmentId;
    dto.doctorId = entity.doctorId;
    dto.status = entity.status;
    dto.isActive = entity.isActive;
    dto.isOpenForJoining = entity.isOpenForJoining;
    dto.requiresJoinApproval = entity.requiresJoinApproval;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    dto.deletedAt = entity.deletedAt;
    dto.deletedBy = entity.deletedBy;

    // Nested relations
    if (entity.patient) dto.patient = entity.patient;
    if (entity.appointment) dto.appointment = entity.appointment;
    if (entity.prescriptions) dto.prescriptions = entity.prescriptions;
    if (entity.notes) dto.notes = entity.notes;
    if (entity.noteTimelines) dto.noteTimelines = entity.noteTimelines;
    if (entity.collaborators) dto.collaborators = entity.collaborators;
    if (entity.joinRequests) dto.joinRequests = entity.joinRequests;

    // notes loaded (findOne) → use array length; list queries → use COUNT from loadRelationCountAndMap
    dto.hasCareNotes = entity.notes != null
      ? entity.notes.length > 0
      : !!((entity as any).notesCount > 0);

    // Compute user-specific fields
    if (userId && entity.collaborators) {
      const userCollaborator = entity.collaborators.find(
        (c) => c.userId === userId && c.isActive && !c.deletedAt,
      );
      dto.isUserCollaborator = !!userCollaborator;
      dto.userRole = userCollaborator ? userCollaborator.role : null;
    } else {
      dto.isUserCollaborator = false;
      dto.userRole = null;
    }

    return dto;
  }
}
