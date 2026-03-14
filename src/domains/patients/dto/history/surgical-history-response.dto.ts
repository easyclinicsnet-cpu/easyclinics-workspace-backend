import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Transform } from 'class-transformer';
import { PastSurgicalHistory } from '../../entities/past-surgical-history.entity';

@Exclude()
export class SurgicalHistoryResponseDto {
  @ApiProperty()
  @Expose()
  id!: string;

  @ApiProperty()
  @Expose()
  workspaceId!: string;

  @ApiProperty()
  @Expose()
  procedure!: string;

  @ApiPropertyOptional()
  @Expose()
  details?: string;

  @ApiPropertyOptional()
  @Expose()
  @Transform(({ value }) => (value ? value.toISOString() : null))
  date?: Date;

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

  static fromEntity(history: PastSurgicalHistory): SurgicalHistoryResponseDto {
    const dto = new SurgicalHistoryResponseDto();
    Object.assign(dto, history);
    return dto;
  }
}
