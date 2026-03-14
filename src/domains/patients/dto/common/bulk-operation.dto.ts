import { IsArray, IsUUID, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class BulkDeleteDto {
  @ApiProperty({ description: 'Array of IDs to delete', type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  ids!: string[];
}

export class BulkUpdateResultDto {
  @ApiProperty({ description: 'Number of items successfully updated' })
  updated!: number;

  @ApiProperty({ description: 'Number of items that failed to update' })
  failed!: number;

  @ApiProperty({ description: 'Array of error messages', type: [String] })
  errors!: string[];
}

export class BulkDeleteResultDto {
  @ApiProperty({ description: 'Number of items successfully deleted' })
  deleted!: number;

  @ApiProperty({ description: 'Number of items that failed to delete' })
  failed!: number;

  @ApiProperty({ description: 'Array of error messages', type: [String] })
  errors!: string[];
}
