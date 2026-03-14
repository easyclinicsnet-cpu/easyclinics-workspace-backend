import { IsString, IsNotEmpty, IsUUID, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVitalDto {
  @ApiProperty({ description: 'Temperature in Celsius' })
  @IsString()
  @IsNotEmpty()
  temperature!: string;

  @ApiPropertyOptional({ description: 'Blood pressure (systolic/diastolic)' })
  @IsString()
  @IsOptional()
  bloodPressure?: string;

  @ApiPropertyOptional({ description: 'Heart rate in BPM' })
  @IsString()
  @IsOptional()
  heartRate?: string;

  @ApiPropertyOptional({ description: 'Oxygen saturation percentage' })
  @IsString()
  @IsOptional()
  saturation?: string;

  @ApiPropertyOptional({ description: 'Glasgow Coma Scale score' })
  @IsString()
  @IsOptional()
  gcs?: string;

  @ApiPropertyOptional({ description: 'Blood glucose in mg/dL' })
  @IsString()
  @IsOptional()
  bloodGlucose?: string;

  @ApiPropertyOptional({ description: 'Height in centimeters' })
  @IsString()
  @IsOptional()
  height?: string;

  @ApiPropertyOptional({ description: 'Weight in kilograms' })
  @IsString()
  @IsOptional()
  weight?: string;

  @ApiPropertyOptional({ description: 'Time of measurement' })
  @IsString()
  @IsOptional()
  time?: string;

  @ApiProperty({ description: 'ID of the patient' })
  @IsUUID()
  @IsNotEmpty()
  patientId!: string;

  @ApiPropertyOptional({ description: 'ID of the appointment' })
  @IsUUID()
  @IsOptional()
  appointmentId?: string;

  @ApiPropertyOptional({ description: 'ID of the consultation' })
  @IsUUID()
  @IsOptional()
  consultationId?: string;

  // workspaceId and userId will be injected by service from JWT context
}
