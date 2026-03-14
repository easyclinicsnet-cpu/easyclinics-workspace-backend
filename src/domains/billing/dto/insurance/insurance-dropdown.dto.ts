import { IsString, IsOptional, IsBoolean, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';

export class ProviderDropdownDto {
  id: string;
  code: string;
  name: string;
  shortName?: string;
  schemeCount: number;
}

export class SchemeDropdownDto {
  id: string;
  code: string;
  name: string;
  providerId: string;
  providerName: string;
  monthlyPremium: number;
  defaultCoverage: number;
}

export class DropdownFilterDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  providerId?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ obj, key }) => { const v = (obj as Record<string, unknown>)[key as string]; return v === true || v === 'true'; })
  isActive?: boolean = true;
}
