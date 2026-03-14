import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InvoiceRepository } from '../repositories/invoice.repository';
import { PatientBillRepository } from '../repositories/patient-bill.repository';
import { PaymentRepository } from '../repositories/payment.repository';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import {
  CreateInvoiceDto,
  UpdateInvoiceDto,
  InvoiceQueryDto,
} from '../dto/requests/invoice.dto';
import { InvoiceResponseDto } from '../dto/responses/invoice.dto';
import { PaginatedResponseMetaDto } from '../dto/common/pagination.dto';
import { Invoice } from '../entities/invoice.entity';
import { PatientBill } from '../entities/patient-bill.entity';
import {
  BillStatus,
  AuditEventType,
  AuditOutcome,
} from '../../../common/enums';

/**
 * Invoice Service
 * Manages the creation, retrieval, updating, and lifecycle of formal
 * billing invoices issued to patients.
 */
@Injectable()
export class InvoiceService {
  constructor(
    private readonly invoiceRepository: InvoiceRepository,
    private readonly patientBillRepository: PatientBillRepository,
    private readonly paymentRepository: PaymentRepository,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext('InvoiceService');
  }

  /**
   * Create a new invoice from an existing patient bill.
   * Copies financial data from the bill and calculates the outstanding amount.
   */
  async createInvoice(
    dto: CreateInvoiceDto,
    userId: string,
    workspaceId: string,
  ): Promise<InvoiceResponseDto> {
    this.logger.log(`Creating invoice for bill ${dto.billId} by user ${userId}`);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Load and validate the bill
      const bill = await this.patientBillRepository.findOne({
        where: { id: dto.billId, isActive: true },
      });

      if (!bill) {
        throw new NotFoundException(`Bill with ID ${dto.billId} not found`);
      }

      // Check if an invoice already exists for this bill
      const existingInvoice = await this.invoiceRepository.findByBill(dto.billId);
      if (existingInvoice) {
        throw new BadRequestException(
          `An invoice already exists for bill ${dto.billId} (Invoice: ${existingInvoice.invoiceNumber})`,
        );
      }

      // Generate a unique invoice number
      const invoiceNumber = await this.invoiceRepository.generateInvoiceNumber();

      // Calculate amount paid and amount due based on completed payments
      const amountPaid = await this.paymentRepository.calculateTotalPaidForBill(dto.billId);
      const total = Number(bill.total);
      const amountDue = total - amountPaid;

      // Create the invoice entity
      const invoice = queryRunner.manager.create(Invoice, {
        invoiceNumber,
        billId: dto.billId,
        patientId: dto.patientId,
        subtotal: Number(bill.subtotal),
        discountAmount: Number(bill.discountAmount),
        taxAmount: Number(bill.taxAmount),
        total,
        amountPaid,
        amountDue: Math.max(amountDue, 0),
        status: amountDue <= 0 ? BillStatus.PAID : BillStatus.PENDING,
        issuedAt: new Date(),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : this.calculateDefaultDueDate(),
        notes: dto.notes,
        terms: dto.terms,
        metadata: dto.metadata,
      });

      const savedInvoice = await queryRunner.manager.save(Invoice, invoice);

      await queryRunner.commitTransaction();

      this.logger.log(
        `Invoice ${invoiceNumber} created successfully with ID ${savedInvoice.id}`,
      );

      // Audit log (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'CREATE_INVOICE',
            eventType: AuditEventType.CREATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'Invoice',
            resourceId: savedInvoice.id,
            patientId: dto.patientId,
            newState: {
              invoiceNumber,
              billId: dto.billId,
              total,
              amountPaid,
              amountDue: Math.max(amountDue, 0),
              status: savedInvoice.status,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for invoice creation: ${auditError.message}`,
          auditError.stack,
        );
      }

      return this.mapToInvoiceResponse(savedInvoice);
    } catch (error) {
      await queryRunner.rollbackTransaction();

      // Audit log for failure (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'CREATE_INVOICE',
            eventType: AuditEventType.CREATE,
            outcome: AuditOutcome.FAILURE,
            resourceType: 'Invoice',
            metadata: {
              billId: dto.billId,
              error: error.message,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for invoice failure: ${auditError.message}`,
          auditError.stack,
        );
      }

      this.logger.error(
        `Failed to create invoice for bill ${dto.billId}: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Update an existing invoice's editable fields.
   */
  async updateInvoice(
    id: string,
    dto: UpdateInvoiceDto,
    userId: string,
    workspaceId: string,
  ): Promise<InvoiceResponseDto> {
    this.logger.log(`Updating invoice ${id} by user ${userId}`);

    const invoice = await this.invoiceRepository.findOne({
      where: { id, isActive: true },
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    if (
      invoice.status === BillStatus.CANCELLED ||
      invoice.status === BillStatus.VOIDED
    ) {
      throw new BadRequestException(
        `Cannot update invoice with status ${invoice.status}`,
      );
    }

    const previousState = {
      status: invoice.status,
      dueDate: invoice.dueDate,
      notes: invoice.notes,
      terms: invoice.terms,
    };

    // Apply updates
    if (dto.status !== undefined) {
      invoice.status = dto.status;
    }
    if (dto.dueDate !== undefined) {
      invoice.dueDate = new Date(dto.dueDate);
    }
    if (dto.notes !== undefined) {
      invoice.notes = dto.notes;
    }
    if (dto.terms !== undefined) {
      invoice.terms = dto.terms;
    }
    if (dto.metadata !== undefined) {
      invoice.metadata = dto.metadata;
    }

    const updatedInvoice = await this.invoiceRepository.save(invoice);

    this.logger.log(`Invoice ${id} updated successfully`);

    // Audit log (non-blocking)
    try {
      await this.auditLogService.log(
        {
          userId,
          action: 'UPDATE_INVOICE',
          eventType: AuditEventType.UPDATE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'Invoice',
          resourceId: id,
          patientId: invoice.patientId,
          previousState,
          newState: {
            status: updatedInvoice.status,
            dueDate: updatedInvoice.dueDate,
            notes: updatedInvoice.notes,
            terms: updatedInvoice.terms,
          },
        },
        workspaceId,
      );
    } catch (auditError) {
      this.logger.error(
        `Failed to create audit log for invoice update: ${auditError.message}`,
        auditError.stack,
      );
    }

    return this.mapToInvoiceResponse(updatedInvoice);
  }

  /**
   * Get a single invoice by its ID.
   */
  async getInvoiceById(
    id: string,
    workspaceId: string,
  ): Promise<InvoiceResponseDto> {
    this.logger.log(`Fetching invoice by ID: ${id}`);

    const invoice = await this.invoiceRepository.findOne({
      where: { id, isActive: true },
      relations: ['bill', 'patient'],
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    return this.mapToInvoiceResponse(invoice);
  }

  /**
   * Get a paginated list of invoices with optional filtering.
   */
  async getInvoices(
    query: InvoiceQueryDto,
    workspaceId: string,
  ): Promise<{ data: InvoiceResponseDto[]; meta: PaginatedResponseMetaDto }> {
    this.logger.log('Fetching invoices with query filters');

    const { page = 1, limit = 10, sortBy, sortOrder = 'DESC' } = query;

    const qb = this.invoiceRepository
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.bill', 'bill')
      .where('invoice.isActive = :isActive', { isActive: true });

    if (query.billId) {
      qb.andWhere('invoice.billId = :billId', { billId: query.billId });
    }

    if (query.patientId) {
      qb.andWhere('invoice.patientId = :patientId', {
        patientId: query.patientId,
      });
    }

    if (query.status) {
      qb.andWhere('invoice.status = :status', { status: query.status });
    }

    if (query.startDate) {
      qb.andWhere('invoice.issuedAt >= :startDate', {
        startDate: new Date(query.startDate),
      });
    }

    if (query.endDate) {
      qb.andWhere('invoice.issuedAt <= :endDate', {
        endDate: new Date(query.endDate),
      });
    }

    const orderField = sortBy ? `invoice.${sortBy}` : 'invoice.issuedAt';
    qb.orderBy(orderField, sortOrder);

    qb.skip((page - 1) * limit).take(limit);

    const [invoices, total] = await qb.getManyAndCount();

    const totalPages = Math.ceil(total / limit);

    const meta: PaginatedResponseMetaDto = {
      total,
      page,
      limit,
      totalPages,
    };

    const data = invoices.map((invoice) => this.mapToInvoiceResponse(invoice));

    return { data, meta };
  }

  /**
   * Get invoices for a specific patient with pagination.
   */
  async getInvoicesByPatient(
    patientId: string,
    page: number = 1,
    limit: number = 10,
    workspaceId: string,
  ): Promise<{ data: InvoiceResponseDto[]; meta: PaginatedResponseMetaDto }> {
    this.logger.log(`Fetching invoices for patient ${patientId}`);

    const [invoices, total] = await this.invoiceRepository.findByPatient(
      patientId,
      page,
      limit,
    );

    const totalPages = Math.ceil(total / limit);

    const meta: PaginatedResponseMetaDto = {
      total,
      page,
      limit,
      totalPages,
    };

    const data = invoices.map((invoice) => this.mapToInvoiceResponse(invoice));

    return { data, meta };
  }

  /**
   * Mark an invoice as paid, setting the paid timestamp and updating amounts.
   */
  async markAsPaid(
    id: string,
    userId: string,
    workspaceId: string,
  ): Promise<InvoiceResponseDto> {
    this.logger.log(`Marking invoice ${id} as paid by user ${userId}`);

    const invoice = await this.invoiceRepository.findOne({
      where: { id, isActive: true },
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    if (invoice.status === BillStatus.PAID) {
      throw new BadRequestException('Invoice is already marked as paid');
    }

    if (
      invoice.status === BillStatus.CANCELLED ||
      invoice.status === BillStatus.VOIDED
    ) {
      throw new BadRequestException(
        `Cannot mark invoice as paid when status is ${invoice.status}`,
      );
    }

    const previousStatus = invoice.status;

    invoice.status = BillStatus.PAID;
    invoice.paidAt = new Date();
    invoice.amountPaid = Number(invoice.total);
    invoice.amountDue = 0;

    const updatedInvoice = await this.invoiceRepository.save(invoice);

    this.logger.log(`Invoice ${id} marked as paid`);

    // Audit log (non-blocking)
    try {
      await this.auditLogService.log(
        {
          userId,
          action: 'MARK_INVOICE_PAID',
          eventType: AuditEventType.UPDATE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'Invoice',
          resourceId: id,
          patientId: invoice.patientId,
          previousState: { status: previousStatus },
          newState: {
            status: BillStatus.PAID,
            paidAt: updatedInvoice.paidAt,
            amountPaid: updatedInvoice.amountPaid,
            amountDue: 0,
          },
        },
        workspaceId,
      );
    } catch (auditError) {
      this.logger.error(
        `Failed to create audit log for invoice paid: ${auditError.message}`,
        auditError.stack,
      );
    }

    return this.mapToInvoiceResponse(updatedInvoice);
  }

  /**
   * Cancel an invoice. Only non-paid, non-cancelled invoices may be cancelled.
   */
  async cancelInvoice(
    id: string,
    userId: string,
    workspaceId: string,
  ): Promise<InvoiceResponseDto> {
    this.logger.log(`Cancelling invoice ${id} by user ${userId}`);

    const invoice = await this.invoiceRepository.findOne({
      where: { id, isActive: true },
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    if (invoice.status === BillStatus.CANCELLED) {
      throw new BadRequestException('Invoice is already cancelled');
    }

    if (invoice.status === BillStatus.PAID) {
      throw new BadRequestException(
        'Cannot cancel a paid invoice. Consider a refund instead.',
      );
    }

    const previousStatus = invoice.status;

    invoice.status = BillStatus.CANCELLED;
    const updatedInvoice = await this.invoiceRepository.save(invoice);

    this.logger.log(`Invoice ${id} cancelled successfully`);

    // Audit log (non-blocking)
    try {
      await this.auditLogService.log(
        {
          userId,
          action: 'CANCEL_INVOICE',
          eventType: AuditEventType.UPDATE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'Invoice',
          resourceId: id,
          patientId: invoice.patientId,
          previousState: { status: previousStatus },
          newState: { status: BillStatus.CANCELLED },
        },
        workspaceId,
      );
    } catch (auditError) {
      this.logger.error(
        `Failed to create audit log for invoice cancellation: ${auditError.message}`,
        auditError.stack,
      );
    }

    return this.mapToInvoiceResponse(updatedInvoice);
  }

  /**
   * Synchronize an invoice's financial data with its associated bill's
   * current payment state. Updates amountPaid, amountDue, and status.
   */
  async syncInvoiceWithBill(
    billId: string,
    workspaceId: string,
  ): Promise<void> {
    this.logger.log(`Syncing invoice with bill ${billId}`);

    const invoice = await this.invoiceRepository.findByBill(billId);

    if (!invoice) {
      this.logger.warn(`No invoice found for bill ${billId}, skipping sync`);
      return;
    }

    if (
      invoice.status === BillStatus.CANCELLED ||
      invoice.status === BillStatus.VOIDED
    ) {
      this.logger.warn(
        `Invoice ${invoice.invoiceNumber} has status ${invoice.status}, skipping sync`,
      );
      return;
    }

    // Recalculate amounts based on current bill payment state
    const bill = await this.patientBillRepository.findOne({
      where: { id: billId, isActive: true },
    });

    if (!bill) {
      this.logger.warn(`Bill ${billId} not found during invoice sync`);
      return;
    }

    const amountPaid = await this.paymentRepository.calculateTotalPaidForBill(billId);
    const total = Number(bill.total);
    const amountDue = Math.max(total - amountPaid, 0);

    // Update invoice financial fields
    invoice.subtotal = Number(bill.subtotal);
    invoice.discountAmount = Number(bill.discountAmount);
    invoice.taxAmount = Number(bill.taxAmount);
    invoice.total = total;
    invoice.amountPaid = amountPaid;
    invoice.amountDue = amountDue;

    // Derive status
    if (amountDue <= 0) {
      invoice.status = BillStatus.PAID;
      invoice.paidAt = invoice.paidAt || new Date();
    } else if (amountPaid > 0) {
      invoice.status = BillStatus.PARTIALLY_PAID;
    } else {
      invoice.status = BillStatus.PENDING;
    }

    await this.invoiceRepository.save(invoice);

    this.logger.log(
      `Invoice ${invoice.invoiceNumber} synced: amountPaid=${amountPaid}, amountDue=${amountDue}, status=${invoice.status}`,
    );
  }

  /**
   * Map an Invoice entity to an InvoiceResponseDto.
   */
  private mapToInvoiceResponse(invoice: Invoice): InvoiceResponseDto {
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      billId: invoice.billId,
      patientId: invoice.patientId,
      subtotal: Number(invoice.subtotal),
      discountAmount: Number(invoice.discountAmount),
      taxAmount: Number(invoice.taxAmount),
      total: Number(invoice.total),
      amountPaid: Number(invoice.amountPaid),
      amountDue: Number(invoice.amountDue),
      status: invoice.status,
      issuedAt: invoice.issuedAt,
      dueDate: invoice.dueDate,
      paidAt: invoice.paidAt,
      notes: invoice.notes,
      terms: invoice.terms,
      metadata: invoice.metadata,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
    };
  }

  /**
   * Calculate the default due date (30 days from now).
   */
  private calculateDefaultDueDate(): Date {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);
    return dueDate;
  }
}
