import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose, Transform } from 'class-transformer';
import { Prescription } from '../../entities/prescription.entity';

/**
 * DTO for prescription response
 */
@Exclude()
export class PrescriptionResponseDto {
  @ApiProperty({ description: 'Prescription ID' })
  @Expose()
  id!: string;

  @ApiProperty({ description: 'Medicine name' })
  @Expose()
  medicine!: string;

  @ApiProperty({ description: 'Dosage', nullable: true })
  @Expose()
  dose?: string;

  @ApiProperty({ description: 'Route of administration', nullable: true })
  @Expose()
  route?: string;

  @ApiProperty({ description: 'Frequency', nullable: true })
  @Expose()
  frequency?: string;

  @ApiProperty({ description: 'Number of days', nullable: true })
  @Expose()
  days?: string;

  @ApiProperty({ description: 'Appointment ID' })
  @Expose()
  appointmentId!: string;

  @ApiProperty({ description: 'Consultation ID' })
  @Expose()
  consultationId!: string;

  @ApiProperty({ description: 'Doctor ID' })
  @Expose()
  doctorId!: string;

  @ApiProperty({ description: 'Care note ID', nullable: true })
  @Expose()
  noteId?: string;

  @ApiProperty({ description: 'Created at' })
  @Expose()
  @Transform(({ value }) => (value ? value.toISOString() : null))
  createdAt!: Date;

  @ApiProperty({ description: 'Updated at' })
  @Expose()
  @Transform(({ value }) => (value ? value.toISOString() : null))
  updatedAt!: Date;

  @ApiProperty({ description: 'Is active' })
  @Expose()
  isActive!: boolean;

  /**
   * Create PrescriptionResponseDto from Prescription entity
   */
  static fromEntity(prescription: Prescription): PrescriptionResponseDto {
    const dto = new PrescriptionResponseDto();
    Object.assign(dto, prescription);
    return dto;
  }
}
