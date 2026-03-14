import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty } from 'class-validator';

/**
 * DTO for updating consultation joining settings
 */
export class UpdateJoiningSettingsDto {
  @ApiProperty({ description: 'Allow other practitioners to request joining' })
  @IsBoolean()
  @IsNotEmpty()
  isOpenForJoining!: boolean;

  @ApiProperty({ description: 'Require manual approval for join requests' })
  @IsBoolean()
  @IsNotEmpty()
  requiresJoinApproval!: boolean;
}
