import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
import { CollaborationRole } from '../../../common/enums';

/**
 * DTO for creating a join request
 */
export class CreateJoinRequestDto {
  @ApiProperty({
    description: 'Consultation ID to join',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  @IsNotEmpty()
  consultationId!: string;

  @ApiProperty({
    description: 'User ID requesting to join',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  @IsNotEmpty()
  requestingUserId!: string;

  @ApiPropertyOptional({
    description: 'Requested collaboration role',
    enum: CollaborationRole,
    default: CollaborationRole.READ_ONLY,
  })
  @IsEnum(CollaborationRole)
  @IsOptional()
  role?: CollaborationRole = CollaborationRole.READ_ONLY;
}
