import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose, Transform } from 'class-transformer';
import { RepeatPrescription } from '../../entities/repeat-prescription.entity';
import { PrescriptionStatus } from '../../../../common/enums';

/**
 * DTO for repeat prescription response
 */
@Exclude()
export class RepeatPrescriptionResponseDto {
  @ApiProperty({ description: 'Repeat prescription ID' })
  @Expose()
  id!: string;

  @ApiProperty({ description: 'Patient ID' })
  @Expose()
  patientId!: string;

  @ApiProperty({ description: 'Doctor ID' })
  @Expose()
  doctorId!: string;

  @ApiProperty({ description: 'Original prescription ID', nullable: true })
  @Expose()
  originalPrescriptionId?: string;

  @ApiProperty({ description: 'Status', enum: PrescriptionStatus })
  @Expose()
  status!: PrescriptionStatus;

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

  @ApiProperty({ description: 'Days supply', nullable: true })
  @Expose()
  daysSupply?: number;

  @ApiProperty({ description: 'Start date' })
  @Expose()
  @Transform(({ value }) => (value ? value.toISOString() : null))
  startDate!: Date;

  @ApiProperty({ description: 'End date', nullable: true })
  @Expose()
  @Transform(({ value }) => (value ? value.toISOString() : null))
  endDate?: Date;

  @ApiProperty({ description: 'Repeat interval', nullable: true })
  @Expose()
  repeatInterval?: number;

  @ApiProperty({ description: 'Repeat interval unit', nullable: true })
  @Expose()
  repeatIntervalUnit?: string;

  @ApiProperty({ description: 'Maximum repeats', nullable: true })
  @Expose()
  maxRepeats?: number;

  @ApiProperty({ description: 'Repeats issued' })
  @Expose()
  repeatsIssued!: number;

  @ApiProperty({ description: 'Last issued date', nullable: true })
  @Expose()
  @Transform(({ value }) => (value ? value.toISOString() : null))
  lastIssuedDate?: Date;

  @ApiProperty({ description: 'Next due date', nullable: true })
  @Expose()
  @Transform(({ value }) => (value ? value.toISOString() : null))
  nextDueDate?: Date;

  @ApiProperty({ description: 'Clinical indication', nullable: true })
  @Expose()
  clinicalIndication?: string;

  @ApiProperty({ description: 'Special instructions', nullable: true })
  @Expose()
  specialInstructions?: string;

  @ApiProperty({ description: 'Review date', nullable: true })
  @Expose()
  @Transform(({ value }) => (value ? value.toISOString() : null))
  reviewDate?: Date;

  @ApiProperty({ description: 'Requires review' })
  @Expose()
  requiresReview!: boolean;

  @ApiProperty({ description: 'Cancellation reason', nullable: true })
  @Expose()
  cancellationReason?: string;

  @ApiProperty({ description: 'Cancelled date', nullable: true })
  @Expose()
  @Transform(({ value }) => (value ? value.toISOString() : null))
  cancelledDate?: Date;

  @ApiProperty({ description: 'Cancelled by', nullable: true })
  @Expose()
  cancelledBy?: string;

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

  @ApiProperty({ description: 'Is overdue for refill' })
  @Expose()
  isOverdue!: boolean;

  @ApiProperty({ description: 'Refills remaining', nullable: true })
  @Expose()
  refillsRemaining?: number;

  /**
   * Create RepeatPrescriptionResponseDto from RepeatPrescription entity
   */
  static fromEntity(repeatPrescription: RepeatPrescription): RepeatPrescriptionResponseDto {
    const dto = new RepeatPrescriptionResponseDto();
    Object.assign(dto, repeatPrescription);

    // Compute derived fields
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check if overdue
    dto.isOverdue = false;
    if (
      repeatPrescription.nextDueDate &&
      repeatPrescription.status === PrescriptionStatus.ACTIVE
    ) {
      const nextDue = new Date(repeatPrescription.nextDueDate);
      nextDue.setHours(0, 0, 0, 0);
      dto.isOverdue = nextDue <= today;
    }

    // Calculate refills remaining
    if (repeatPrescription.maxRepeats) {
      dto.refillsRemaining = repeatPrescription.maxRepeats - repeatPrescription.repeatsIssued;
    }

    return dto;
  }
}
