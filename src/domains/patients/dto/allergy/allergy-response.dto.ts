import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose, Transform } from 'class-transformer';
import { Allergy } from '../../entities/allergy.entity';
import { Severity } from '../../../../common/enums';

@Exclude()
export class AllergyResponseDto {
  @ApiProperty()
  @Expose()
  id!: string;

  @ApiProperty()
  @Expose()
  workspaceId!: string;

  @ApiProperty()
  @Expose()
  substance!: string;

  @ApiProperty()
  @Expose()
  reaction!: string;

  @ApiProperty({ enum: Severity })
  @Expose()
  severity!: Severity;

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

  static fromEntity(allergy: Allergy): AllergyResponseDto {
    const dto = new AllergyResponseDto();
    Object.assign(dto, allergy);
    return dto;
  }
}
