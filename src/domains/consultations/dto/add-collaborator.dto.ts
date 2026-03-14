import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ValidateNested, IsNotEmpty, IsUUID, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { CollaborationRole } from '../../../common/enums';

/**
 * DTO for single collaborator in batch add
 */
export class CollaboratorItemDto {
  @ApiProperty({
    description: 'User ID of the collaborator',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({
    description: 'Role of the collaborator',
    enum: CollaborationRole,
  })
  @IsEnum(CollaborationRole)
  @IsNotEmpty()
  role!: CollaborationRole;
}

/**
 * DTO for adding collaborators to consultation
 */
export class AddCollaboratorDto {
  @ApiProperty({
    description: 'Array of collaborators to add',
    type: [CollaboratorItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CollaboratorItemDto)
  @IsNotEmpty()
  collaborators!: CollaboratorItemDto[];
}
