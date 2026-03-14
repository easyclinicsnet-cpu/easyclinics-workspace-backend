import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import { Appointment } from '../entities/appointment.entity';

/**
 * Response DTO for appointment data
 * Excludes sensitive fields and includes computed properties
 */
export class AppointmentResponseDto {
  @Expose()
  @ApiProperty({ description: 'Appointment ID' })
  id!: string;

  @Expose()
  @ApiProperty({ description: 'Patient ID' })
  patientId!: string;

  @Expose()
  @ApiProperty({ description: 'Appointment date' })
  date!: string;

  @Expose()
  @ApiProperty({ description: 'Appointment time' })
  time!: string;

  @Expose()
  @ApiProperty({ description: 'Appointment status' })
  status!: string;

  @Expose()
  @ApiProperty({ description: 'Payment method' })
  paymentMethod!: string;

  @Expose()
  @ApiProperty({ description: 'Appointment type' })
  type!: string;

  @Expose()
  @ApiProperty({ description: 'Active status' })
  isActive!: boolean;

  @Expose()
  @ApiPropertyOptional({ description: 'Patient information' })
  patient?: any;

  @Expose()
  @ApiProperty({ description: 'Has linked consultation' })
  hasConsultation: boolean = false;

  @Expose()
  @ApiPropertyOptional({ description: 'Consultation ID' })
  consultationId?: string;

  @Expose()
  @ApiProperty({ description: 'Has consultation notes' })
  hasCareNotes: boolean = false;

  @Expose()
  @ApiProperty({ description: 'Has recorded vitals for this appointment' })
  hasVitals: boolean = false;

  @Expose()
  @ApiProperty({ description: 'Has linked bill' })
  hasBill: boolean = false;

  @Expose()
  @ApiPropertyOptional({ description: 'Bill ID' })
  billId?: string;

  @Expose()
  @ApiProperty({ description: 'Created at timestamp' })
  createdAt!: Date;

  @Expose()
  @ApiProperty({ description: 'Updated at timestamp' })
  updatedAt!: Date;

  @Expose()
  @ApiPropertyOptional({ description: 'User ID who created the appointment' })
  userId?: string;

  @Expose()
  @ApiPropertyOptional({ description: 'Workspace ID' })
  workspaceId?: string;

  // Exclude sensitive fields
  @Exclude()
  transcriptionId?: string;

  @Exclude()
  deletedAt?: Date;

  @Exclude()
  deletedBy?: string;

  @Exclude()
  isDeleted?: boolean;

  /**
   * Create DTO from entity
   */
  static fromEntity(entity: Appointment): AppointmentResponseDto {
    const dto = new AppointmentResponseDto();
    Object.assign(dto, {
      id: entity.id,
      patientId: entity.patientId,
      billId: entity.patientBill?.id,
      hasBill: !!entity.patientBill,
      consultationId: entity.consultationId,
      date: entity.date,
      time: entity.time,
      status: entity.status,
      paymentMethod: entity.paymentMethod,
      type: entity.type,
      isActive: entity.isActive,
      patient: entity.patient,
      hasConsultation: !!entity.consultationId,
      hasCareNotes: !!((entity.consultation as any)?.notesCount > 0),
      hasVitals: !!((entity as any)?.vitalsCount > 0),
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      userId: entity.userId,
      workspaceId: entity.workspaceId,
    });
    return dto;
  }

  /**
   * Create DTO array from entity array
   */
  static fromEntities(entities: Appointment[]): AppointmentResponseDto[] {
    return entities.map((entity) => AppointmentResponseDto.fromEntity(entity));
  }
}
