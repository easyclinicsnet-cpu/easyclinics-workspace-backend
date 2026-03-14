import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InsuranceScheme, SchemeType } from '../../entities/insurance-scheme.entity';
import { ProviderStatus } from '../../entities/insurance-provider.entity';

export class InsuranceSchemeResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() providerId!: string;
  @ApiProperty() schemeCode!: string;
  @ApiProperty() schemeName!: string;
  @ApiProperty({ enum: SchemeType }) schemeType!: SchemeType;
  @ApiProperty({ enum: ProviderStatus }) status!: ProviderStatus;
  @ApiPropertyOptional() description?: string;
  @ApiProperty() defaultCoveragePercentage!: number;
  @ApiPropertyOptional() coverageRules?: any;
  @ApiPropertyOptional() benefitLimits?: any;
  @ApiPropertyOptional() authorizationRequirements?: any;
  @ApiProperty() requiresPreAuthorization!: boolean;
  @ApiProperty() restrictedToNetwork!: boolean;
  @ApiPropertyOptional() networkProviders?: string;
  @ApiPropertyOptional() outOfNetworkPenalty?: number;
  @ApiProperty() monthlyPremium!: number;
  @ApiPropertyOptional() annualDeductible?: number;
  @ApiPropertyOptional() copaymentAmount?: number;
  @ApiPropertyOptional() effectiveDate?: Date;
  @ApiPropertyOptional() expiryDate?: Date;
  @ApiPropertyOptional() metadata?: any;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  /** Name alias for backward compatibility */
  get name(): string { return this.schemeName; }

  static fromEntity(entity: InsuranceScheme): InsuranceSchemeResponseDto {
    const dto = new InsuranceSchemeResponseDto();
    dto.id                          = entity.id;
    dto.providerId                  = entity.providerId;
    dto.schemeCode                  = entity.schemeCode;
    dto.schemeName                  = entity.schemeName;
    dto.schemeType                  = entity.schemeType;
    dto.status                      = entity.status;
    dto.description                 = entity.description;
    dto.defaultCoveragePercentage   = Number(entity.defaultCoveragePercentage);
    dto.coverageRules               = entity.coverageRules;
    dto.benefitLimits               = entity.benefitLimits;
    dto.authorizationRequirements   = entity.authorizationRequirements;
    dto.requiresPreAuthorization    = entity.requiresPreAuthorization;
    dto.restrictedToNetwork         = entity.restrictedToNetwork;
    dto.networkProviders            = entity.networkProviders;
    dto.outOfNetworkPenalty         = entity.outOfNetworkPenalty != null ? Number(entity.outOfNetworkPenalty) : undefined;
    dto.monthlyPremium              = Number(entity.monthlyPremium);
    dto.annualDeductible            = entity.annualDeductible != null ? Number(entity.annualDeductible) : undefined;
    dto.copaymentAmount             = entity.copaymentAmount != null ? Number(entity.copaymentAmount) : undefined;
    dto.effectiveDate               = entity.effectiveDate;
    dto.expiryDate                  = entity.expiryDate;
    dto.metadata                    = entity.metadata;
    dto.isActive                    = entity.isActive;
    dto.createdAt                   = entity.createdAt;
    dto.updatedAt                   = entity.updatedAt;
    return dto;
  }
}
