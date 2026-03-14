import { IsString, IsNotEmpty, IsEnum, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Severity } from '../../../../common/enums';

export class CreateAllergyDto {
  @ApiProperty({ description: 'Substance causing the allergy' })
  @IsString()
  @IsNotEmpty()
  substance!: string;

  @ApiProperty({ description: 'Reaction to the allergen' })
  @IsString()
  @IsNotEmpty()
  reaction!: string;

  @ApiProperty({ enum: Severity, description: 'Severity of the allergy' })
  @IsEnum(Severity)
  @IsNotEmpty()
  severity!: Severity;

  @ApiProperty({ description: 'ID of the patient' })
  @IsUUID()
  @IsNotEmpty()
  patientId!: string;

  // workspaceId and userId will be injected by service from JWT context
}
