import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CollaborationRole } from '../../../common/enums';
import { ConsultationCollaborator } from '../entities/consultation-collaborator.entity';

/**
 * DTO for consultation collaborator response
 */
export class CollaboratorResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  consultationId!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty({ enum: CollaborationRole })
  role!: CollaborationRole;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiPropertyOptional()
  deletedAt?: Date;

  @ApiPropertyOptional()
  deletedById?: string;

  @ApiPropertyOptional()
  lastAccessedAt?: Date;

  /**
   * Create response DTO from entity
   * @param entity ConsultationCollaborator entity
   * @returns CollaboratorResponseDto
   */
  static fromEntity(entity: ConsultationCollaborator): CollaboratorResponseDto {
    const dto = new CollaboratorResponseDto();

    dto.id = entity.id;
    dto.consultationId = entity.consultationId;
    dto.userId = entity.userId;
    dto.role = entity.role;
    dto.isActive = entity.isActive;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    dto.deletedAt = entity.deletedAt;
    dto.deletedById = entity.deletedById;
    dto.lastAccessedAt = entity.lastAccessedAt;

    return dto;
  }
}
