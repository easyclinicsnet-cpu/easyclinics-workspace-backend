import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import { InsuranceProvider } from '../../insurance/entities/insurance-provider.entity';
import { InsuranceScheme } from '../../insurance/entities/insurance-scheme.entity';
import {
  ProviderDropdownDto,
  SchemeDropdownDto,
  DropdownFilterDto,
} from '../dto/insurance/insurance-dropdown.dto';

/**
 * Service for populating insurance-related dropdowns in the billing UI.
 *
 * Provides lightweight, un-paginated lists of insurance providers and
 * schemes suitable for select inputs, comboboxes, and autocomplete fields.
 *
 * This service reads from the insurance domain entities but lives in the
 * billing domain because it serves billing-specific UI needs.
 */
@Injectable()
export class InsuranceDropdownService {
  constructor(
    @InjectRepository(InsuranceProvider)
    private readonly providerRepository: Repository<InsuranceProvider>,
    @InjectRepository(InsuranceScheme)
    private readonly schemeRepository: Repository<InsuranceScheme>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('InsuranceDropdownService');
  }

  /**
   * Get a list of insurance providers for dropdown selection.
   *
   * @param filter  Optional search / active filters
   * @param workspaceId  Workspace ID for multi-tenancy
   * @returns Array of provider dropdown items
   */
  async getProviderDropdown(
    filter: DropdownFilterDto,
    workspaceId: string,
  ): Promise<ProviderDropdownDto[]> {
    this.logger.log(`Fetching provider dropdown for workspace: ${workspaceId}`);

    try {
      const qb = this.providerRepository
        .createQueryBuilder('provider')
        .leftJoin('provider.schemes', 'scheme')
        .select([
          'provider.id',
          'provider.providerCode',
          'provider.name',
          'provider.shortName',
        ])
        .addSelect('COUNT(scheme.id)', 'schemeCount')
        .where('provider.isActive = :isActive', {
          isActive: filter.isActive !== undefined ? filter.isActive : true,
        })
        .andWhere('provider.deletedAt IS NULL')
        .groupBy('provider.id');

      if (filter.search) {
        qb.andWhere(
          '(provider.name LIKE :search OR provider.shortName LIKE :search OR provider.providerCode LIKE :search)',
          { search: `%${filter.search}%` },
        );
      }

      qb.orderBy('provider.name', 'ASC');

      const rawResults = await qb.getRawMany();

      return rawResults.map((row) => ({
        id: row.provider_id,
        code: row.provider_providerCode || row.provider_provider_code || '',
        name: row.provider_name,
        shortName: row.provider_shortName || row.provider_short_name,
        schemeCount: Number(row.schemeCount) || 0,
      }));
    } catch (error) {
      this.logger.error(
        `Failed to fetch provider dropdown: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  /**
   * Get a list of insurance schemes for dropdown selection.
   * Optionally filtered by provider.
   *
   * @param filter  Optional search / provider / active filters
   * @param workspaceId  Workspace ID for multi-tenancy
   * @returns Array of scheme dropdown items
   */
  async getSchemeDropdown(
    filter: DropdownFilterDto,
    workspaceId: string,
  ): Promise<SchemeDropdownDto[]> {
    this.logger.log(`Fetching scheme dropdown for workspace: ${workspaceId}`);

    try {
      const qb = this.schemeRepository
        .createQueryBuilder('scheme')
        .leftJoinAndSelect('scheme.provider', 'provider')
        .where('scheme.isActive = :isActive', {
          isActive: filter.isActive !== undefined ? filter.isActive : true,
        })
        .andWhere('scheme.deletedAt IS NULL');

      if (filter.providerId) {
        qb.andWhere('scheme.providerId = :providerId', {
          providerId: filter.providerId,
        });
      }

      if (filter.search) {
        qb.andWhere(
          '(scheme.schemeName LIKE :search OR scheme.schemeCode LIKE :search)',
          { search: `%${filter.search}%` },
        );
      }

      qb.orderBy('provider.name', 'ASC').addOrderBy('scheme.schemeName', 'ASC');

      const schemes = await qb.getMany();

      return schemes.map((scheme) => ({
        id: scheme.id,
        code: scheme.schemeCode || '',
        name: scheme.schemeName,
        providerId: scheme.providerId,
        providerName: scheme.provider?.name || '',
        monthlyPremium: Number(scheme.monthlyPremium) || 0,
        defaultCoverage: Number(scheme.defaultCoveragePercentage) || 0,
      }));
    } catch (error) {
      this.logger.error(
        `Failed to fetch scheme dropdown: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  /**
   * Get schemes for a specific provider.
   *
   * @param providerId  Insurance provider ID
   * @param workspaceId  Workspace ID for multi-tenancy
   * @returns Array of scheme dropdown items for the provider
   */
  async getSchemesByProvider(
    providerId: string,
    workspaceId: string,
  ): Promise<SchemeDropdownDto[]> {
    return this.getSchemeDropdown(
      { providerId, isActive: true },
      workspaceId,
    );
  }
}
