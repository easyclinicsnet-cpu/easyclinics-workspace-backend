import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PaymentRepository } from '../repositories/payment.repository';
import { PatientBillRepository } from '../repositories/patient-bill.repository';
import { PaymentMethodRepository } from '../repositories/payment-method.repository';
import { BillingTransactionRepository } from '../repositories/billing-transaction.repository';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import {
  CreatePaymentDto,
  UpdatePaymentDto,
  PaymentQueryDto,
} from '../dto/requests/payment.dto';
import {
  PaymentResponseDto,
  PaymentBreakdownDto,
} from '../dto/responses/payment.dto';
import { PaginatedResponseMetaDto } from '../dto/common/pagination.dto';
import { Payment } from '../entities/payment.entity';
import { PatientBill } from '../entities/patient-bill.entity';
import { PaymentMethod } from '../entities/payment-method.entity';
import { BillingTransaction } from '../entities/billing-transaction.entity';
import {
  PaymentStatus,
  BillStatus,
  AuditEventType,
  AuditOutcome,
} from '../../../common/enums';
import { BILLING_DEFAULTS, BILLING_ERROR_CODES } from '../utils/billing.constants';

/**
 * Payment Service
 * Handles payment creation, processing, refunds, and queries against patient bills.
 */
@Injectable()
export class PaymentService {
  constructor(
    private readonly paymentRepository: PaymentRepository,
    private readonly patientBillRepository: PatientBillRepository,
    private readonly paymentMethodRepository: PaymentMethodRepository,
    private readonly billingTransactionRepository: BillingTransactionRepository,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext('PaymentService');
  }

  /**
   * Create a new payment against a patient bill.
   * Validates the bill, payment method, and amount before creating the payment
   * within a database transaction.
   */
  async createPayment(
    dto: CreatePaymentDto,
    userId: string,
    workspaceId: string,
  ): Promise<PaymentResponseDto> {
    this.logger.log(`Creating payment for bill ${dto.billId} by user ${userId}`);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Validate bill exists and is in a payable state
      const bill = await this.patientBillRepository.findOne({
        where: { id: dto.billId, isActive: true },
      });

      if (!bill) {
        throw new NotFoundException(
          `Bill with ID ${dto.billId} not found`,
        );
      }

      if (
        bill.status === BillStatus.CANCELLED ||
        bill.status === BillStatus.VOIDED ||
        bill.status === BillStatus.PAID
      ) {
        throw new BadRequestException(
          `Cannot create payment for bill with status ${bill.status}. ` +
            `Error code: ${BILLING_ERROR_CODES.BILL_ALREADY_PAID}`,
        );
      }

      // Validate payment method exists and is active
      const paymentMethod = await this.paymentMethodRepository.findOne({
        where: { id: dto.paymentMethodId, isActive: true },
      });

      if (!paymentMethod) {
        throw new NotFoundException(
          `Payment method with ID ${dto.paymentMethodId} not found or inactive. ` +
            `Error code: ${BILLING_ERROR_CODES.INVALID_PAYMENT_METHOD}`,
        );
      }

      // Calculate total already paid on this bill
      const totalPaid = await this.paymentRepository.calculateTotalPaidForBill(dto.billId);
      const billBalance = Number(bill.total) - totalPaid;

      // Validate amount does not exceed bill balance
      if (dto.amount > billBalance) {
        throw new BadRequestException(
          `Payment amount ${dto.amount} exceeds bill balance of ${billBalance}. ` +
            `Error code: ${BILLING_ERROR_CODES.PAYMENT_EXCEEDS_BALANCE}`,
        );
      }

      // Validate amount against billing defaults
      if (dto.amount > BILLING_DEFAULTS.MAX_PAYMENT_AMOUNT) {
        throw new BadRequestException(
          `Payment amount exceeds the maximum allowed amount of ${BILLING_DEFAULTS.MAX_PAYMENT_AMOUNT}`,
        );
      }

      // Calculate processing fee and net amount
      const feePercentage = Number(paymentMethod.processingFeePercentage || 0);
      const processingFee = this.calculateProcessingFee(dto.amount, feePercentage);
      const netAmount = dto.amount - processingFee;

      // Generate unique payment reference
      const paymentReference = await this.paymentRepository.generatePaymentReference();

      // Create the payment entity
      const payment = queryRunner.manager.create(Payment, {
        paymentReference,
        billId: dto.billId,
        patientId: dto.patientId,
        paymentMethodId: dto.paymentMethodId,
        amount: dto.amount,
        processingFeePercentage: feePercentage,
        processingFee,
        netAmount,
        status: PaymentStatus.PENDING,
        paymentDate: new Date(),
        transactionId: dto.transactionId,
        chequeNumber: dto.chequeNumber,
        bankName: dto.bankName,
        accountNumber: dto.accountNumber,
        cardLastFour: dto.cardLastFour,
        cardType: dto.cardType,
        authorizationCode: dto.authorizationCode,
        insuranceProvider: dto.insuranceProvider,
        insurancePolicyNumber: dto.insurancePolicyNumber,
        authorizationNumber: dto.authorizationNumber,
        notes: dto.notes,
        paymentDetails: dto.paymentDetails,
        metadata: dto.metadata,
      });

      const savedPayment = await queryRunner.manager.save(Payment, payment);

      // Create a billing transaction record for the payment
      const transactionReference =
        await this.billingTransactionRepository.generateTransactionReference();

      const billingTransaction = queryRunner.manager.create(BillingTransaction, {
        transactionReference,
        transactionType: 'PAYMENT',
        billId: dto.billId,
        paymentId: savedPayment.id,
        amount: dto.amount,
        balanceBefore: billBalance,
        balanceAfter: billBalance - dto.amount,
        status: PaymentStatus.PENDING,
        transactionDate: new Date(),
        processedBy: userId,
        description: `Payment ${paymentReference} created for bill ${bill.billNumber}`,
      });

      await queryRunner.manager.save(BillingTransaction, billingTransaction);

      await queryRunner.commitTransaction();

      this.logger.log(
        `Payment ${paymentReference} created successfully with ID ${savedPayment.id}`,
      );

      // Audit log (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'CREATE_PAYMENT',
            eventType: AuditEventType.CREATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'Payment',
            resourceId: savedPayment.id,
            patientId: dto.patientId,
            newState: {
              paymentReference,
              billId: dto.billId,
              amount: dto.amount,
              processingFee,
              netAmount,
              status: PaymentStatus.PENDING,
            },
            metadata: { paymentMethodId: dto.paymentMethodId },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for payment creation: ${auditError.message}`,
          auditError.stack,
        );
      }

      // Re-fetch with relations for complete response
      const fullPayment = await this.paymentRepository.findOne({
        where: { id: savedPayment.id },
        relations: ['paymentMethod'],
      });

      return this.mapToPaymentResponse(fullPayment || savedPayment);
    } catch (error) {
      await queryRunner.rollbackTransaction();

      // Audit log for failure (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'CREATE_PAYMENT',
            eventType: AuditEventType.CREATE,
            outcome: AuditOutcome.FAILURE,
            resourceType: 'Payment',
            metadata: {
              billId: dto.billId,
              amount: dto.amount,
              error: error.message,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for payment failure: ${auditError.message}`,
          auditError.stack,
        );
      }

      this.logger.error(
        `Failed to create payment for bill ${dto.billId}: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Process a pending payment, marking it as completed and updating the bill status.
   */
  async processPayment(
    paymentId: string,
    userId: string,
    workspaceId: string,
  ): Promise<PaymentResponseDto> {
    this.logger.log(`Processing payment ${paymentId} by user ${userId}`);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const payment = await this.paymentRepository.findOne({
        where: { id: paymentId, isActive: true },
        relations: ['paymentMethod'],
      });

      if (!payment) {
        throw new NotFoundException(`Payment with ID ${paymentId} not found`);
      }

      if (payment.status !== PaymentStatus.PENDING) {
        throw new BadRequestException(
          `Payment can only be processed when in PENDING status. Current status: ${payment.status}. ` +
            `Error code: ${BILLING_ERROR_CODES.INVALID_STATUS_TRANSITION}`,
        );
      }

      const previousStatus = payment.status;

      // Mark payment as completed
      payment.status = PaymentStatus.COMPLETED;
      payment.processedAt = new Date();

      await queryRunner.manager.save(Payment, payment);

      // Update the bill status based on total payments
      const bill = await this.patientBillRepository.findOne({
        where: { id: payment.billId, isActive: true },
      });

      if (bill) {
        const totalPaid = await this.paymentRepository.calculateTotalPaidForBill(
          payment.billId,
        );
        // Include current payment amount since calculateTotalPaidForBill
        // may not yet reflect the newly committed status
        const effectiveTotalPaid = totalPaid + Number(payment.amount);

        const billTotal = Number(bill.total);

        if (effectiveTotalPaid >= billTotal) {
          bill.status = BillStatus.PAID;
        } else if (effectiveTotalPaid > 0) {
          bill.status = BillStatus.PARTIALLY_PAID;
        }

        await queryRunner.manager.save(PatientBill, bill);
      }

      await queryRunner.commitTransaction();

      this.logger.log(`Payment ${paymentId} processed successfully`);

      // Audit log (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'PROCESS_PAYMENT',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'Payment',
            resourceId: paymentId,
            patientId: payment.patientId,
            previousState: { status: previousStatus },
            newState: {
              status: PaymentStatus.COMPLETED,
              processedAt: payment.processedAt,
              billStatus: bill?.status,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for payment processing: ${auditError.message}`,
          auditError.stack,
        );
      }

      return this.mapToPaymentResponse(payment);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Failed to process payment ${paymentId}: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Refund a completed payment. Creates a reversal billing transaction and
   * updates the associated bill status accordingly.
   */
  async refundPayment(
    paymentId: string,
    reason: string,
    userId: string,
    workspaceId: string,
  ): Promise<PaymentResponseDto> {
    this.logger.log(`Refunding payment ${paymentId} by user ${userId}`);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const payment = await this.paymentRepository.findOne({
        where: { id: paymentId, isActive: true },
        relations: ['paymentMethod'],
      });

      if (!payment) {
        throw new NotFoundException(`Payment with ID ${paymentId} not found`);
      }

      if (payment.status !== PaymentStatus.COMPLETED) {
        throw new BadRequestException(
          `Only completed payments can be refunded. Current status: ${payment.status}. ` +
            `Error code: ${BILLING_ERROR_CODES.INVALID_STATUS_TRANSITION}`,
        );
      }

      const previousStatus = payment.status;

      // Mark payment as refunded
      payment.status = PaymentStatus.REFUNDED;
      payment.refundedAt = new Date();
      payment.notes = payment.notes
        ? `${payment.notes}\nRefund reason: ${reason}`
        : `Refund reason: ${reason}`;

      await queryRunner.manager.save(Payment, payment);

      // Create reversal billing transaction
      const bill = await this.patientBillRepository.findOne({
        where: { id: payment.billId, isActive: true },
      });

      const totalPaidAfterRefund = await this.paymentRepository.calculateTotalPaidForBill(
        payment.billId,
      );
      // Subtract the refunded payment amount
      const effectiveTotalPaid = totalPaidAfterRefund - Number(payment.amount);
      const billTotal = bill ? Number(bill.total) : 0;
      const balanceBefore = billTotal - totalPaidAfterRefund;
      const balanceAfter = billTotal - Math.max(effectiveTotalPaid, 0);

      const transactionReference =
        await this.billingTransactionRepository.generateTransactionReference();

      const reversalTransaction = queryRunner.manager.create(BillingTransaction, {
        transactionReference,
        transactionType: 'REFUND',
        billId: payment.billId,
        paymentId: payment.id,
        amount: -Number(payment.amount),
        balanceBefore,
        balanceAfter,
        status: 'COMPLETED',
        transactionDate: new Date(),
        processedBy: userId,
        description: `Refund for payment ${payment.paymentReference}. Reason: ${reason}`,
      });

      await queryRunner.manager.save(BillingTransaction, reversalTransaction);

      // Update the bill status
      if (bill) {
        if (effectiveTotalPaid <= 0) {
          bill.status = BillStatus.REFUNDED;
        } else if (effectiveTotalPaid < billTotal) {
          bill.status = BillStatus.PARTIALLY_PAID;
        }

        await queryRunner.manager.save(PatientBill, bill);
      }

      await queryRunner.commitTransaction();

      this.logger.log(`Payment ${paymentId} refunded successfully`);

      // Audit log (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'REFUND_PAYMENT',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'Payment',
            resourceId: paymentId,
            patientId: payment.patientId,
            previousState: { status: previousStatus },
            newState: {
              status: PaymentStatus.REFUNDED,
              refundedAt: payment.refundedAt,
              reason,
              billStatus: bill?.status,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for payment refund: ${auditError.message}`,
          auditError.stack,
        );
      }

      return this.mapToPaymentResponse(payment);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Failed to refund payment ${paymentId}: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Get a single payment by its ID.
   */
  async getPaymentById(
    id: string,
    workspaceId: string,
  ): Promise<PaymentResponseDto> {
    this.logger.log(`Fetching payment by ID: ${id}`);

    const payment = await this.paymentRepository.findOne({
      where: { id, isActive: true },
      relations: ['paymentMethod'],
    });

    if (!payment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }

    return this.mapToPaymentResponse(payment);
  }

  /**
   * Get a paginated list of payments with optional filtering.
   */
  async getPayments(
    query: PaymentQueryDto,
    workspaceId: string,
  ): Promise<{ data: PaymentResponseDto[]; meta: PaginatedResponseMetaDto }> {
    this.logger.log('Fetching payments with query filters');

    const { page = 1, limit = 10, sortBy, sortOrder = 'DESC' } = query;

    const qb = this.paymentRepository
      .createQueryBuilder('payment')
      .leftJoinAndSelect('payment.paymentMethod', 'paymentMethod')
      .where('payment.isActive = :isActive', { isActive: true });

    if (query.billId) {
      qb.andWhere('payment.billId = :billId', { billId: query.billId });
    }

    if (query.patientId) {
      qb.andWhere('payment.patientId = :patientId', {
        patientId: query.patientId,
      });
    }

    if (query.status) {
      qb.andWhere('payment.status = :status', { status: query.status });
    }

    if (query.paymentMethodId) {
      qb.andWhere('payment.paymentMethodId = :paymentMethodId', {
        paymentMethodId: query.paymentMethodId,
      });
    }

    if (query.startDate) {
      qb.andWhere('payment.paymentDate >= :startDate', {
        startDate: new Date(query.startDate),
      });
    }

    if (query.endDate) {
      qb.andWhere('payment.paymentDate <= :endDate', {
        endDate: new Date(query.endDate),
      });
    }

    const orderField = sortBy ? `payment.${sortBy}` : 'payment.paymentDate';
    qb.orderBy(orderField, sortOrder);

    qb.skip((page - 1) * limit).take(limit);

    const [payments, total] = await qb.getManyAndCount();

    const totalPages = Math.ceil(total / limit);

    const meta: PaginatedResponseMetaDto = {
      total,
      page,
      limit,
      totalPages,
    };

    const data = payments.map((payment) => this.mapToPaymentResponse(payment));

    return { data, meta };
  }

  /**
   * Get all payments associated with a specific bill.
   */
  async getPaymentsByBill(
    billId: string,
    workspaceId: string,
  ): Promise<PaymentResponseDto[]> {
    this.logger.log(`Fetching payments for bill ${billId}`);

    const payments = await this.paymentRepository.findByBill(billId);

    return payments.map((payment) => this.mapToPaymentResponse(payment));
  }

  /**
   * Cancel a pending payment. Only payments in PENDING status can be cancelled.
   */
  async cancelPayment(
    paymentId: string,
    userId: string,
    workspaceId: string,
  ): Promise<PaymentResponseDto> {
    this.logger.log(`Cancelling payment ${paymentId} by user ${userId}`);

    const payment = await this.paymentRepository.findOne({
      where: { id: paymentId, isActive: true },
      relations: ['paymentMethod'],
    });

    if (!payment) {
      throw new NotFoundException(`Payment with ID ${paymentId} not found`);
    }

    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException(
        `Only pending payments can be cancelled. Current status: ${payment.status}. ` +
          `Error code: ${BILLING_ERROR_CODES.INVALID_STATUS_TRANSITION}`,
      );
    }

    const previousStatus = payment.status;

    payment.status = PaymentStatus.CANCELLED;
    await this.paymentRepository.save(payment);

    this.logger.log(`Payment ${paymentId} cancelled successfully`);

    // Audit log (non-blocking)
    try {
      await this.auditLogService.log(
        {
          userId,
          action: 'CANCEL_PAYMENT',
          eventType: AuditEventType.UPDATE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'Payment',
          resourceId: paymentId,
          patientId: payment.patientId,
          previousState: { status: previousStatus },
          newState: { status: PaymentStatus.CANCELLED },
        },
        workspaceId,
      );
    } catch (auditError) {
      this.logger.error(
        `Failed to create audit log for payment cancellation: ${auditError.message}`,
        auditError.stack,
      );
    }

    return this.mapToPaymentResponse(payment);
  }

  /**
   * Map a Payment entity to a PaymentResponseDto.
   */
  private mapToPaymentResponse(payment: Payment): PaymentResponseDto {
    const response: PaymentResponseDto = {
      id: payment.id,
      paymentReference: payment.paymentReference,
      billId: payment.billId,
      patientId: payment.patientId,
      paymentMethodId: payment.paymentMethodId,
      amount: Number(payment.amount),
      processingFee: Number(payment.processingFee),
      netAmount: Number(payment.netAmount),
      status: payment.status,
      transactionId: payment.transactionId,
      paymentDate: payment.paymentDate,
      processedAt: payment.processedAt,
      refundedAt: payment.refundedAt,
      failedAt: payment.failedAt,
      notes: payment.notes,
      failureReason: payment.failureReason,
      metadata: payment.metadata,
      createdAt: payment.createdAt,
    };

    if (payment.paymentMethod) {
      response.paymentMethodType = payment.paymentMethod.type;
      response.paymentMethod = {
        id: payment.paymentMethod.id,
        name: payment.paymentMethod.name,
        type: payment.paymentMethod.type,
      };
    }

    return response;
  }

  /**
   * Calculate the processing fee based on the payment amount and fee percentage.
   * Rounds to two decimal places.
   */
  private calculateProcessingFee(amount: number, feePercentage: number): number {
    if (!feePercentage || feePercentage <= 0) {
      return 0;
    }

    const fee = (amount * feePercentage) / 100;
    return Math.round(fee * 100) / 100;
  }
}
