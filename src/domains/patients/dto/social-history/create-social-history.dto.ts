import { IsEnum, IsOptional, IsString, IsUUID, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SmokingStatus, AlcoholUse, DrugUse } from '../../../../common/enums';

export class CreateSocialHistoryDto {
  @ApiProperty({ enum: SmokingStatus, description: 'Smoking status' })
  @IsEnum(SmokingStatus)
  @IsOptional()
  smokingStatus?: SmokingStatus = SmokingStatus.NEVER;

  @ApiProperty({ enum: AlcoholUse, description: 'Alcohol usage' })
  @IsEnum(AlcoholUse)
  @IsOptional()
  alcoholUse?: AlcoholUse = AlcoholUse.NEVER;

  @ApiProperty({ enum: DrugUse, description: 'Drug usage' })
  @IsEnum(DrugUse)
  @IsOptional()
  drugUse?: DrugUse = DrugUse.NEVER;

  @ApiPropertyOptional({ description: 'Patient occupation' })
  @IsString()
  @IsOptional()
  occupation?: string;

  @ApiPropertyOptional({ description: 'Additional notes' })
  @IsString()
  @IsOptional()
  additionalNotes?: string;

  @ApiProperty({ description: 'ID of the patient' })
  @IsUUID()
  @IsNotEmpty()
  patientId!: string;

  // workspaceId and userId will be injected by service from JWT context
}
