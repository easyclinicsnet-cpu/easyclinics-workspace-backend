import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Transform } from 'class-transformer';
import { SocialHistory } from '../../entities/social-history.entity';
import { SmokingStatus, AlcoholUse, DrugUse } from '../../../../common/enums';

@Exclude()
export class SocialHistoryResponseDto {
  @ApiProperty()
  @Expose()
  id!: string;

  @ApiProperty()
  @Expose()
  workspaceId!: string;

  @ApiProperty({ enum: SmokingStatus })
  @Expose()
  smokingStatus!: SmokingStatus;

  @ApiProperty({ enum: AlcoholUse })
  @Expose()
  alcoholUse!: AlcoholUse;

  @ApiProperty({ enum: DrugUse })
  @Expose()
  drugUse!: DrugUse;

  @ApiPropertyOptional()
  @Expose()
  occupation?: string;

  @ApiPropertyOptional()
  @Expose()
  additionalNotes?: string;

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

  static fromEntity(socialHistory: SocialHistory): SocialHistoryResponseDto {
    const dto = new SocialHistoryResponseDto();
    Object.assign(dto, socialHistory);
    return dto;
  }
}
