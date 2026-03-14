import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsUUID, IsNotEmpty } from 'class-validator';
import { RequestStatus } from '../../../common/enums';

/**
 * DTO for processing a join request (approve/reject)
 */
export class ProcessJoinRequestDto {
  @ApiProperty({
    description: 'Action to take on the request',
    enum: [RequestStatus.APPROVED, RequestStatus.REJECTED],
  })
  @IsEnum([RequestStatus.APPROVED, RequestStatus.REJECTED])
  @IsNotEmpty()
  status!: RequestStatus.APPROVED | RequestStatus.REJECTED;

  @ApiProperty({
    description: 'User ID processing the request',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  @IsNotEmpty()
  processedBy!: string;
}
