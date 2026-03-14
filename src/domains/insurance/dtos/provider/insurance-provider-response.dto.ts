import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InsuranceProvider, ProviderStatus } from '../../entities/insurance-provider.entity';

export class InsuranceProviderResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() providerCode!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional() shortName?: string;
  @ApiProperty({ enum: ProviderStatus }) status!: ProviderStatus;
  @ApiPropertyOptional() description?: string;
  @ApiPropertyOptional() contactInfo?: any;
  @ApiPropertyOptional() processingTimes?: any;
  @ApiProperty() requiresPreAuthorization!: boolean;
  @ApiProperty() supportsElectronicClaims!: boolean;
  @ApiPropertyOptional() claimsSubmissionFormat?: string;
  @ApiProperty() defaultCopaymentPercentage!: number;
  @ApiPropertyOptional() maximumClaimAmount?: number;
  @ApiPropertyOptional() minimumClaimAmount?: number;
  @ApiPropertyOptional() contractNumber?: string;
  @ApiPropertyOptional() contractStartDate?: Date;
  @ApiPropertyOptional() contractEndDate?: Date;
  @ApiPropertyOptional() termsAndConditions?: string;
  @ApiPropertyOptional() address?: string;
  @ApiPropertyOptional() metadata?: any;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static fromEntity(entity: InsuranceProvider): InsuranceProviderResponseDto {
    const dto = new InsuranceProviderResponseDto();
    dto.id                          = entity.id;
    dto.providerCode                = entity.providerCode;
    dto.name                        = entity.name;
    dto.shortName                   = entity.shortName;
    dto.status                      = entity.status;
    dto.description                 = entity.description;
    dto.contactInfo                 = entity.contactInfo;
    dto.processingTimes             = entity.processingTimes;
    dto.requiresPreAuthorization    = entity.requiresPreAuthorization;
    dto.supportsElectronicClaims    = entity.supportsElectronicClaims;
    dto.claimsSubmissionFormat      = entity.claimsSubmissionFormat;
    dto.defaultCopaymentPercentage  = Number(entity.defaultCopaymentPercentage);
    dto.maximumClaimAmount          = entity.maximumClaimAmount != null ? Number(entity.maximumClaimAmount) : undefined;
    dto.minimumClaimAmount          = entity.minimumClaimAmount != null ? Number(entity.minimumClaimAmount) : undefined;
    dto.contractNumber              = entity.contractNumber;
    dto.contractStartDate           = entity.contractStartDate;
    dto.contractEndDate             = entity.contractEndDate;
    dto.termsAndConditions          = entity.termsAndConditions;
    dto.address                     = entity.address;
    dto.metadata                    = entity.metadata;
    dto.isActive                    = entity.isActive;
    dto.createdAt                   = entity.createdAt;
    dto.updatedAt                   = entity.updatedAt;
    return dto;
  }
}
