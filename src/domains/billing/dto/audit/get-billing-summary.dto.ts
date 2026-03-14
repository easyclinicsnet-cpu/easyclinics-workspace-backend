import { IsDateString, IsOptional, IsString } from 'class-validator';

export class GetBillingSummaryDto {
  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsString()
  @IsOptional()
  department?: string;

  @IsString()
  @IsOptional()
  groupBy?: 'day' | 'week' | 'month';
}
