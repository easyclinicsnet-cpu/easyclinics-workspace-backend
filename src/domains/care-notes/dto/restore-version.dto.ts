import { IsInt, Min } from 'class-validator';

export class RestoreVersionDto {
  @IsInt()
  @Min(1)
  versionNumber: number;
}
