import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Transform } from 'class-transformer';
import { Vital } from '../../entities/vital.entity';

@Exclude()
export class VitalResponseDto {
  @ApiProperty()
  @Expose()
  id!: string;

  @ApiProperty()
  @Expose()
  workspaceId!: string;

  @ApiProperty()
  @Expose()
  temperature!: string;

  @ApiProperty()
  @Expose()
  bloodPressure!: string;

  @ApiProperty()
  @Expose()
  heartRate!: string;

  @ApiProperty()
  @Expose()
  saturation!: string;

  @ApiProperty()
  @Expose()
  gcs!: string;

  @ApiProperty()
  @Expose()
  bloodGlucose!: string;

  @ApiProperty()
  @Expose()
  height!: string;

  @ApiProperty()
  @Expose()
  weight!: string;

  @ApiProperty()
  @Expose()
  time!: string;

  @ApiProperty()
  @Expose()
  patientId!: string;

  @ApiPropertyOptional()
  @Expose()
  appointmentId?: string;

  @ApiPropertyOptional()
  @Expose()
  consultationId?: string;

  @ApiProperty()
  @Expose()
  userId!: string;

  @ApiProperty()
  @Expose()
  @Transform(({ value }) => (value ? value.toISOString() : null))
  createdAt!: Date;

  @ApiProperty()
  @Expose()
  @Transform(({ value }) => (value ? value.toISOString() : null))
  updatedAt!: Date;

  @ApiProperty()
  @Expose()
  isActive!: boolean;

  static fromEntity(vital: Vital): VitalResponseDto {
    const dto = new VitalResponseDto();
    Object.assign(dto, vital);
    return dto;
  }
}
