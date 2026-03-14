import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Transform } from 'class-transformer';
import { PastMedicalHistory } from '../../entities/past-medical-history.entity';

@Exclude()
export class MedicalHistoryResponseDto {
  @ApiProperty()
  @Expose()
  id!: string;

  @ApiProperty()
  @Expose()
  workspaceId!: string;

  @ApiProperty()
  @Expose()
  condition!: string;

  @ApiPropertyOptional()
  @Expose()
  details?: string;

  @ApiProperty()
  @Expose()
  patientId!: string;

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

  static fromEntity(history: PastMedicalHistory): MedicalHistoryResponseDto {
    const dto = new MedicalHistoryResponseDto();
    Object.assign(dto, history);
    return dto;
  }
}
