import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { CollaborationRole } from '../../../common/enums';

/**
 * DTO for updating collaborator role
 */
export class UpdateCollaboratorRoleDto {
  @ApiProperty({
    description: 'New role for the collaborator',
    enum: CollaborationRole,
  })
  @IsEnum(CollaborationRole)
  @IsNotEmpty()
  role!: CollaborationRole;
}
