import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Transform } from 'class-transformer';
import { SickNote } from '../entities/sick-note.entity';
import { SickNoteStatus } from '../../../common/enums';

/**
 * Response DTO for SickNote — all fields exposed via @Expose().
 * Use SickNoteResponseDto.fromEntity(sickNote) to create an instance.
 */
@Exclude()
export class SickNoteResponseDto {
  @ApiProperty({ description: 'Sick note ID' })
  @Expose()
  id: string;

  @ApiProperty({ description: 'Workspace ID' })
  @Expose()
  workspaceId: string;

  @ApiProperty({ description: 'Patient ID' })
  @Expose()
  patientId: string;

  @ApiProperty({ description: 'Prescribing doctor ID' })
  @Expose()
  doctorId: string;

  @ApiPropertyOptional({ description: 'Linked care note ID' })
  @Expose()
  noteId?: string;

  @ApiPropertyOptional({ description: 'Linked consultation ID' })
  @Expose()
  consultationId?: string;

  @ApiProperty({ description: 'Status', enum: SickNoteStatus })
  @Expose()
  status: SickNoteStatus;

  @ApiProperty({ description: 'Date the note was issued' })
  @Expose()
  @Transform(({ value }) => (value ? new Date(value).toISOString() : null))
  issueDate: Date;

  @ApiProperty({ description: 'Leave start date' })
  @Expose()
  @Transform(({ value }) => (value ? new Date(value).toISOString() : null))
  startDate: Date;

  @ApiProperty({ description: 'Leave end date' })
  @Expose()
  @Transform(({ value }) => (value ? new Date(value).toISOString() : null))
  endDate: Date;

  @ApiProperty({ description: 'Duration in calendar days' })
  @Expose()
  durationDays: number;

  @ApiProperty({ description: 'Diagnosis (encrypted at rest)' })
  @Expose()
  diagnosis: string;

  @ApiPropertyOptional({ description: 'Clinical recommendations (encrypted at rest)' })
  @Expose()
  recommendations?: string;

  @ApiPropertyOptional({ description: 'Employer name' })
  @Expose()
  employerName?: string;

  @ApiPropertyOptional({ description: 'Employer address' })
  @Expose()
  employerAddress?: string;

  @ApiProperty({ description: 'Patient is fit for light duties' })
  @Expose()
  isFitForLightDuties: boolean;

  @ApiPropertyOptional({ description: 'Light duties description' })
  @Expose()
  lightDutiesDescription?: string;

  @ApiPropertyOptional({ description: 'Certificate number' })
  @Expose()
  certificateNumber?: string;

  @ApiPropertyOptional({ description: 'Arbitrary metadata (cancellation info, extension refs, etc.)' })
  @Expose()
  metadata?: Record<string, any>;

  @ApiProperty({ description: 'Created at' })
  @Expose()
  @Transform(({ value }) => (value ? new Date(value).toISOString() : null))
  createdAt: Date;

  @ApiProperty({ description: 'Updated at' })
  @Expose()
  @Transform(({ value }) => (value ? new Date(value).toISOString() : null))
  updatedAt: Date;

  @ApiPropertyOptional({ description: 'Deleted at (soft-delete timestamp)' })
  @Expose()
  @Transform(({ value }) => (value ? new Date(value).toISOString() : null))
  deletedAt?: Date;

  // ── Computed ──────────────────────────────────────────────────────────────

  @ApiProperty({ description: 'True when status is ISSUED and endDate has not passed' })
  @Expose()
  isActive: boolean;

  @ApiProperty({ description: 'True when endDate is in the past' })
  @Expose()
  isExpired: boolean;

  // ── Factory ───────────────────────────────────────────────────────────────

  static fromEntity(sickNote: SickNote): SickNoteResponseDto {
    const dto = new SickNoteResponseDto();
    Object.assign(dto, sickNote);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const endDate = sickNote.endDate ? new Date(sickNote.endDate) : null;
    if (endDate) endDate.setHours(0, 0, 0, 0);

    dto.isExpired = endDate ? endDate < today : false;
    dto.isActive  = sickNote.status === SickNoteStatus.ISSUED && !dto.isExpired;

    return dto;
  }
}
