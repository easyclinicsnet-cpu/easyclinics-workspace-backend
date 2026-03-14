import { IsDateString, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ExtendSickNoteDto {
  @ApiProperty({ description: 'New end date for the extended period ISO 8601' })
  @IsDateString()
  newEndDate: string;

  @ApiProperty({ description: 'Duration of the extension in days', minimum: 1 })
  @IsInt()
  @Min(1)
  extendedDuration: number;

  @ApiPropertyOptional({ description: 'ID of the original note being extended' })
  @IsOptional()
  @IsUUID()
  originalNoteId?: string;
}
