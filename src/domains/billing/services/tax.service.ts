import { IsNull } from 'typeorm';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { TaxRepository } from '../repositories/tax.repository';
import { PatientBillRepository } from '../repositories/patient-bill.repository';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import {
  CreateTaxDto,
  UpdateTaxDto,
  TaxQueryDto,
} from '../dto/requests/tax.dto';
import { TaxResponseDto } from '../dto/responses/tax.dto';
import { PaginatedResponseMetaDto } from '../dto/common/pagination.dto';
import { Tax } from '../entities/tax.entity';
import { AuditEventType, AuditOutcome } from '../../../common/enums';

/**
 * Service for managing tax configurations in the billing domain
 * Handles CRUD operations, tax calculations, application to bills,
 * and tax filtering with HIPAA-compliant audit logging
 */
@Injectable()
export class TaxService {
  constructor(
    private readonly taxRepository: TaxRepository,
    private readonly patientBillRepository: PatientBillRepository,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext('TaxService');
  }

  /**
   * Create a new tax configuration
   * Validates that the rate is between 0 and 100
   * @param dto Tax creation data
   * @param userId User ID creating the tax
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Created tax response
   */
  async createTax(
    dto: CreateTaxDto,
    userId: string,
    workspaceId: string,
  ): Promise<TaxResponseDto> {
    this.logger.log(`Creating tax: ${dto.name}, workspace: ${workspaceId}`);

    try {
      // Validate rate is between 0 and 100
      if (dto.rate < 0 || dto.rate > 100) {
        throw new BadRequestException('Tax rate must be between 0 and 100');
      }

      // Validate date range if both dates are provided
      if (dto.effectiveFrom && dto.effectiveUntil) {
        const from = new Date(dto.effectiveFrom);
        const until = new Date(dto.effectiveUntil);
        if (from >= until) {
          throw new BadRequestException(
            'effectiveFrom must be before effectiveUntil',
          );
        }
      }

      const tax = this.taxRepository.create({
        ...dto,
        effectiveFrom: dto.effectiveFrom
          ? new Date(dto.effectiveFrom)
          : undefined,
        effectiveUntil: dto.effectiveUntil
          ? new Date(dto.effectiveUntil)
          : undefined,
      });

      const savedTax = await this.taxRepository.save(tax);

      this.logger.log(`Tax created successfully - ID: ${savedTax.id}`);

      // Audit log (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'CREATE_TAX',
            eventType: AuditEventType.CREATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'Tax',
            resourceId: savedTax.id,
            metadata: {
              name: dto.name,
              taxType: dto.taxType,
              rate: dto.rate,
              isCompound: dto.isCompound,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for tax creation - ID: ${savedTax.id}`,
          auditError.stack,
        );
      }

      return this.mapToTaxResponse(savedTax);
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      this.logger.error(`Failed to create tax: ${dto.name}`, error.stack);
      throw error;
    }
  }

  /**
   * Update an existing tax configuration
   * @param id Tax ID
   * @param dto Update data
   * @param userId User ID performing the update
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Updated tax response
   */
  async updateTax(
    id: string,
    dto: UpdateTaxDto,
    userId: string,
    workspaceId: string,
  ): Promise<TaxResponseDto> {
    this.logger.log(`Updating tax: ${id}, workspace: ${workspaceId}`);

    try {
      const tax = await this.taxRepository.findOne({
        where: { id, isActive: true, deletedAt: IsNull() },
      });

      if (!tax) {
        this.logger.error(`Tax not found: ${id}`);
        throw new NotFoundException(`Tax with ID ${id} not found`);
      }

      // Validate rate if provided
      if (dto.rate !== undefined && (dto.rate < 0 || dto.rate > 100)) {
        throw new BadRequestException('Tax rate must be between 0 and 100');
      }

      // Validate date range if both dates resolve
      const effectiveFrom = dto.effectiveFrom
        ? new Date(dto.effectiveFrom)
        : tax.effectiveFrom;
      const effectiveUntil = dto.effectiveUntil
        ? new Date(dto.effectiveUntil)
        : tax.effectiveUntil;
      if (effectiveFrom && effectiveUntil && effectiveFrom >= effectiveUntil) {
        throw new BadRequestException(
          'effectiveFrom must be before effectiveUntil',
        );
      }

      const previousState = { ...tax };

      // Apply updates
      Object.assign(tax, {
        ...dto,
        effectiveFrom: dto.effectiveFrom
          ? new Date(dto.effectiveFrom)
          : tax.effectiveFrom,
        effectiveUntil: dto.effectiveUntil
          ? new Date(dto.effectiveUntil)
          : tax.effectiveUntil,
      });

      const updatedTax = await this.taxRepository.save(tax);

      this.logger.log(`Tax updated successfully - ID: ${id}`);

      // Audit log (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'UPDATE_TAX',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'Tax',
            resourceId: id,
            previousState: {
              name: previousState.name,
              rate: previousState.rate,
              taxType: previousState.taxType,
            },
            metadata: {
              updates: Object.keys(dto),
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for tax update - ID: ${id}`,
          auditError.stack,
        );
      }

      return this.mapToTaxResponse(updatedTax);
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      this.logger.error(`Failed to update tax: ${id}`, error.stack);
      throw error;
    }
  }

  /**
   * Get a single tax configuration by ID
   * @param id Tax ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Tax response
   */
  async getTaxById(id: string, workspaceId: string): Promise<TaxResponseDto> {
    this.logger.log(`Finding tax by ID: ${id}, workspace: ${workspaceId}`);

    try {
      const tax = await this.taxRepository.findOne({
        where: { id, isActive: true, deletedAt: IsNull() },
      });

      if (!tax) {
        this.logger.error(`Tax not found: ${id}`);
        throw new NotFoundException(`Tax with ID ${id} not found`);
      }

      return this.mapToTaxResponse(tax);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to find tax by ID: ${id}`, error.stack);
      throw error;
    }
  }

  /**
   * Get all taxes with filtering and pagination
   * @param query Query parameters with filters
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Paginated tax list
   */
  async getTaxes(
    query: TaxQueryDto,
    workspaceId: string,
  ): Promise<{ data: TaxResponseDto[]; meta: PaginatedResponseMetaDto }> {
    this.logger.log(`Finding taxes for workspace: ${workspaceId}`);

    try {
      const page = query.page || 1;
      const limit = Math.min(query.limit || 10, 100);

      const qb = this.taxRepository
        .createQueryBuilder('tax')
        .where('tax.isActive = :isActive', { isActive: true })
        .andWhere('tax.deletedAt IS NULL');

      // Apply filters
      if (query.taxType) {
        qb.andWhere('tax.taxType = :taxType', { taxType: query.taxType });
      }

      if (query.search) {
        qb.andWhere(
          '(tax.name LIKE :search OR tax.description LIKE :search)',
          { search: `%${query.search}%` },
        );
      }

      // Apply sorting
      const sortBy = query.sortBy || 'createdAt';
      const sortOrder = query.sortOrder || 'DESC';
      qb.orderBy(`tax.${sortBy}`, sortOrder);

      // Apply pagination
      qb.skip((page - 1) * limit).take(limit);

      const [taxes, total] = await qb.getManyAndCount();

      return {
        data: taxes.map((tax) => this.mapToTaxResponse(tax)),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to find taxes for workspace: ${workspaceId}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Soft delete a tax configuration
   * @param id Tax ID
   * @param userId User ID performing the deletion
   * @param workspaceId Workspace ID for multi-tenancy
   */
  async deleteTax(
    id: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    this.logger.log(`Deleting tax: ${id}, workspace: ${workspaceId}`);

    try {
      const tax = await this.taxRepository.findOne({
        where: { id, isActive: true, deletedAt: IsNull() },
      });

      if (!tax) {
        this.logger.error(`Tax not found: ${id}`);
        throw new NotFoundException(`Tax with ID ${id} not found`);
      }

      // Soft delete
      tax.isActive = false;
      tax.isDeleted = true;
      tax.deletedAt = new Date();
      tax.deletedBy = userId;
      await this.taxRepository.save(tax);

      this.logger.log(`Tax deleted successfully - ID: ${id}`);

      // Audit log (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'DELETE_TAX',
            eventType: AuditEventType.DELETE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'Tax',
            resourceId: id,
            metadata: {
              name: tax.name,
              taxType: tax.taxType,
              rate: tax.rate,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for tax deletion - ID: ${id}`,
          auditError.stack,
        );
      }
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to delete tax: ${id}`, error.stack);
      throw error;
    }
  }

  /**
   * Get all active tax configurations
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns List of active tax responses
   */
  async getActiveTaxes(workspaceId: string): Promise<TaxResponseDto[]> {
    this.logger.log(`Finding active taxes for workspace: ${workspaceId}`);

    try {
      const taxes = await this.taxRepository.findAllActive();

      return taxes.map((tax) => this.mapToTaxResponse(tax));
    } catch (error) {
      this.logger.error(
        `Failed to find active taxes for workspace: ${workspaceId}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get taxes applicable to a specific department and/or service type
   * Filters by effective date range and applicable departments/services
   * @param department Optional department filter
   * @param serviceType Optional service type filter
   * @param workspaceId Optional workspace ID for multi-tenancy
   * @returns List of applicable tax responses
   */
  async getApplicableTaxes(
    department?: string,
    serviceType?: string,
    workspaceId?: string,
  ): Promise<TaxResponseDto[]> {
    this.logger.log(
      `Finding applicable taxes for department: ${department || 'all'}, serviceType: ${serviceType || 'all'}`,
    );

    try {
      // Fetch all currently valid taxes (active, within effective date range)
      const validTaxes = await this.taxRepository.findValidTaxes();

      // Further filter by department and service type
      const applicableTaxes = validTaxes.filter((tax) => {
        // Check applicable departments
        if (department && tax.applicableDepartments) {
          const departments = Array.isArray(tax.applicableDepartments)
            ? tax.applicableDepartments
            : [];
          if (departments.length > 0 && !departments.includes(department)) {
            return false;
          }
        }

        // Check applicable services
        if (serviceType && tax.applicableServices) {
          const services = Array.isArray(tax.applicableServices)
            ? tax.applicableServices
            : [];
          if (services.length > 0 && !services.includes(serviceType)) {
            return false;
          }
        }

        return true;
      });

      return applicableTaxes.map((tax) => this.mapToTaxResponse(tax));
    } catch (error) {
      this.logger.error(
        `Failed to find applicable taxes for department: ${department || 'all'}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Calculate the tax amount for a given tax rate applied to a base amount
   * @param taxId Tax ID
   * @param amount Base amount to calculate tax on
   * @returns Calculated tax amount
   */
  async calculateTaxAmount(taxId: string, amount: number): Promise<number> {
    this.logger.log(
      `Calculating tax amount for tax: ${taxId}, amount: ${amount}`,
    );

    try {
      const tax = await this.taxRepository.findOne({
        where: { id: taxId, isActive: true, deletedAt: IsNull() },
      });

      if (!tax) {
        this.logger.error(`Tax not found: ${taxId}`);
        throw new NotFoundException(`Tax with ID ${taxId} not found`);
      }

      // Calculate tax as a percentage of the amount
      let taxAmount = (amount * Number(tax.rate)) / 100;

      // Round to 2 decimal places
      taxAmount = Math.round(taxAmount * 100) / 100;

      this.logger.log(
        `Calculated tax amount: ${taxAmount} (rate: ${tax.rate}%) for tax: ${taxId}`,
      );

      return taxAmount;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to calculate tax amount for tax: ${taxId}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Apply a tax to an existing bill
   * Calculates tax amount on the bill subtotal (after discount), updates bill totals
   * @param billId Bill ID to apply the tax to
   * @param taxId Tax ID to apply
   * @param userId User ID performing the action
   * @param workspaceId Workspace ID for multi-tenancy
   */
  async applyTaxToBill(
    billId: string,
    taxId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    this.logger.log(
      `Applying tax ${taxId} to bill ${billId}, workspace: ${workspaceId}`,
    );

    try {
      // Load and validate bill
      const bill = await this.patientBillRepository.findOne({
        where: { id: billId, isActive: true, deletedAt: IsNull() },
      });

      if (!bill) {
        this.logger.error(`Bill not found: ${billId}`);
        throw new NotFoundException(`Bill with ID ${billId} not found`);
      }

      // Load and validate tax
      const tax = await this.taxRepository.findOne({
        where: { id: taxId, isActive: true, deletedAt: IsNull() },
      });

      if (!tax) {
        this.logger.error(`Tax not found: ${taxId}`);
        throw new NotFoundException(`Tax with ID ${taxId} not found`);
      }

      // Check effective dates
      const now = new Date();
      if (tax.effectiveFrom && now < tax.effectiveFrom) {
        throw new BadRequestException(
          `Tax "${tax.name}" is not yet effective (effective from: ${tax.effectiveFrom.toISOString()})`,
        );
      }
      if (tax.effectiveUntil && now > tax.effectiveUntil) {
        throw new BadRequestException(
          `Tax "${tax.name}" has expired (effective until: ${tax.effectiveUntil.toISOString()})`,
        );
      }

      // Calculate tax on the taxable amount (subtotal minus discount)
      const taxableAmount = Number(bill.subtotal) - Number(bill.discountAmount);
      const taxAmount = await this.calculateTaxAmount(taxId, taxableAmount);

      // Update bill with tax
      bill.taxId = taxId;
      bill.taxAmount = taxAmount;
      bill.total = Number(bill.subtotal) - Number(bill.discountAmount) + taxAmount;

      // Round total to 2 decimal places
      bill.total = Math.round(bill.total * 100) / 100;

      await this.patientBillRepository.save(bill);

      this.logger.log(
        `Tax ${taxId} applied to bill ${billId} - tax amount: ${taxAmount}`,
      );

      // Audit log (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'APPLY_TAX_TO_BILL',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'PatientBill',
            resourceId: billId,
            metadata: {
              taxId,
              taxName: tax.name,
              taxRate: tax.rate,
              taxAmount,
              taxableAmount,
              newTotal: bill.total,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for tax application - bill: ${billId}`,
          auditError.stack,
        );
      }
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error(
        `Failed to apply tax ${taxId} to bill ${billId}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Remove an applied tax from a bill
   * Clears tax fields and recalculates the bill total
   * @param billId Bill ID to remove the tax from
   * @param userId User ID performing the action
   * @param workspaceId Workspace ID for multi-tenancy
   */
  async removeTaxFromBill(
    billId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    this.logger.log(
      `Removing tax from bill ${billId}, workspace: ${workspaceId}`,
    );

    try {
      const bill = await this.patientBillRepository.findOne({
        where: { id: billId, isActive: true, deletedAt: IsNull() },
      });

      if (!bill) {
        this.logger.error(`Bill not found: ${billId}`);
        throw new NotFoundException(`Bill with ID ${billId} not found`);
      }

      if (!bill.taxId) {
        throw new BadRequestException(
          `Bill with ID ${billId} does not have an applied tax`,
        );
      }

      const previousTaxId = bill.taxId;
      const previousTaxAmount = bill.taxAmount;

      // Clear tax fields and recalculate total
      bill.taxId = undefined;
      bill.taxAmount = 0;
      bill.total = Number(bill.subtotal) - Number(bill.discountAmount);
      bill.total = Math.round(bill.total * 100) / 100;

      await this.patientBillRepository.save(bill);

      this.logger.log(`Tax removed from bill ${billId}`);

      // Audit log (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'REMOVE_TAX_FROM_BILL',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'PatientBill',
            resourceId: billId,
            previousState: {
              taxId: previousTaxId,
              taxAmount: previousTaxAmount,
            },
            metadata: {
              newTotal: bill.total,
              billSubtotal: bill.subtotal,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for tax removal - bill: ${billId}`,
          auditError.stack,
        );
      }
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error(
        `Failed to remove tax from bill ${billId}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Map a Tax entity to a TaxResponseDto
   * @param tax Tax entity
   * @returns TaxResponseDto
   */
  private mapToTaxResponse(tax: Tax): TaxResponseDto {
    const response = new TaxResponseDto();
    response.id = tax.id;
    response.name = tax.name;
    response.description = tax.description;
    response.taxType = tax.taxType;
    response.rate = Number(tax.rate);
    response.isCompound = tax.isCompound;
    response.applicableServices = tax.applicableServices;
    response.applicableDepartments = tax.applicableDepartments;
    response.effectiveFrom = tax.effectiveFrom;
    response.effectiveUntil = tax.effectiveUntil;
    response.isActive = tax.isActive;
    response.metadata = tax.metadata;
    response.createdAt = tax.createdAt;
    response.updatedAt = tax.updatedAt;
    return response;
  }
}
