import { IsIn, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApproveAiNoteDto {
  @ApiProperty({
    description: 'Action to take on the AI note',
    enum: ['approve', 'reject'],
    example: 'approve',
  })
  @IsIn(['approve', 'reject'])
  action!: 'approve' | 'reject';

  @ApiPropertyOptional({
    description: 'Optional reason for approval or rejection',
    example: 'Note accurately reflects the consultation',
  })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({
    description: 'Optional modifications to apply on approval',
    type: Object,
  })
  @IsOptional()
  modifications?: Record<string, any>;
}
