import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CollaborationRole, RequestStatus } from '../../../common/enums';
import { ConsultationJoinRequest } from '../entities/consultation-join-request.entity';

/**
 * DTO for join request response
 */
export class JoinRequestResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  consultationId!: string;

  @ApiProperty()
  requestingUserId!: string;

  @ApiProperty({ enum: CollaborationRole })
  role!: CollaborationRole;

  @ApiProperty({ enum: RequestStatus })
  status!: RequestStatus;

  @ApiPropertyOptional()
  processedBy?: string;

  @ApiPropertyOptional()
  processedAt?: Date;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  /**
   * Create response DTO from entity
   * @param entity ConsultationJoinRequest entity
   * @returns JoinRequestResponseDto
   */
  static fromEntity(entity: ConsultationJoinRequest): JoinRequestResponseDto {
    const dto = new JoinRequestResponseDto();

    dto.id = entity.id;
    dto.consultationId = entity.consultationId;
    dto.requestingUserId = entity.requestingUserId;
    dto.role = entity.role;
    dto.status = entity.status;
    dto.processedBy = entity.processedBy;
    dto.processedAt = entity.processedAt;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;

    return dto;
  }
}
