import { Module } from '@nestjs/common';

// ─── Controllers ───────────────────────────────────────────────────────────────
import { BillController }                from './controllers/bill.controller';
import { InsuranceClaimController }      from './controllers/insurance-claim.controller';
import { InsuranceClaimPdfController }   from './controllers/insurance-claim-pdf.controller';
import { InsuranceDropdownController }   from './controllers/insurance-dropdown.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

// ─── Billing Domain Entities ────────────────────────────────────────────────────
import { PatientBill } from './entities/patient-bill.entity';
import { BillItem } from './entities/bill-item.entity';
import { Payment } from './entities/payment.entity';
import { PaymentMethod } from './entities/payment-method.entity';
import { Invoice } from './entities/invoice.entity';
import { Receipt } from './entities/receipt.entity';
import { Discount } from './entities/discount.entity';
import { Tax } from './entities/tax.entity';
import { PricingStrategy } from './entities/pricing-strategy.entity';
import { BillingTransaction } from './entities/billing-transaction.entity';

// ─── Insurance Domain Entities (cross-domain) ──────────────────────────────────
import { InsuranceClaim } from '../insurance/entities/insurance-claim.entity';
import { InsuranceClaimItem } from '../insurance/entities/insurance-claim-item.entity';
import { InsuranceProvider } from '../insurance/entities/insurance-provider.entity';
import { InsuranceScheme } from '../insurance/entities/insurance-scheme.entity';
import { PatientInsurance } from '../insurance/entities/patient-insurance.entity';
import { InsuranceContract } from '../insurance/entities/insurance-contract.entity';

// ─── Billing Services ──────────────────────────────────────────────────────────
import { BillService } from './services/bill.service';
import { PaymentService } from './services/payment.service';
import { InvoiceService } from './services/invoice.service';
import { DiscountService } from './services/discount.service';
import { TaxService } from './services/tax.service';
import { InsuranceClaimService } from './services/insurance-claim.service';
import { BillingOrchestrationService } from './services/billing-orchestration.service';
import { BillingAnalyticsService } from './services/billing-analytics.service';
import { InsuranceDropdownService } from './services/insurance-dropdown.service';
import { ClaimPdfService } from './services/claim-pdf.service';

// ─── Billing Repositories ──────────────────────────────────────────────────────
import { PatientBillRepository } from './repositories/patient-bill.repository';
import { BillItemRepository } from './repositories/bill-item.repository';
import { PaymentRepository } from './repositories/payment.repository';
import { PaymentMethodRepository } from './repositories/payment-method.repository';
import { InvoiceRepository } from './repositories/invoice.repository';
import { ReceiptRepository } from './repositories/receipt.repository';
import { DiscountRepository } from './repositories/discount.repository';
import { TaxRepository } from './repositories/tax.repository';
import { PricingStrategyRepository } from './repositories/pricing-strategy.repository';
import { BillingTransactionRepository } from './repositories/billing-transaction.repository';

// ─── Billing Strategies ────────────────────────────────────────────────────────
import { BillingStrategyFactory } from './strategies/billing-strategy.factory';
import { DispenseBillingStrategy } from './strategies/dispense-billing.strategy';
import { ServiceBillingStrategy } from './strategies/service-billing.strategy';
import { ReturnBillingStrategy } from './strategies/return-billing.strategy';
import { AdjustmentBillingStrategy } from './strategies/adjustment-billing.strategy';

// ─── Common Infrastructure ─────────────────────────────────────────────────────
import { LoggerModule } from '../../common/logger/logger.module';
import { LoggerService } from '../../common/logger/logger.service';
import { DatabaseModule } from '../../common/database/database.module';
import { Aes256Module } from '../../common/security/encryption/aes-256.module';
import { SecurityModule } from '../../common/security/security.module';

// ─── Audit Module ──────────────────────────────────────────────────────────────
import { AuditModule } from '../audit/audit.module';

/**
 * Billing Domain Module
 *
 * Manages all billing, payments, invoicing, and financial transaction
 * functionality for the EasyClinics EMR platform.
 *
 * Architecture:
 * - DDD modular monolith with clean architecture separation
 * - Multi-tenant (workspaceId scoped on all service methods)
 * - Strategy Pattern for billing operations (dispense, service, return, adjustment)
 * - Factory pattern for repository registration
 * - HIPAA-compliant audit logging with PHI redaction
 * - AES-256-CBC encryption support via common Aes256Service
 *
 * Cross-Domain Dependencies:
 * - Insurance domain entities (InsuranceClaim, InsuranceClaimItem, InsuranceProvider,
 *   InsuranceScheme, PatientInsurance, InsuranceContract) are registered in
 *   TypeOrmModule.forFeature for direct repository access from billing services.
 * - Audit domain (AuditLogService) for HIPAA-compliant audit trail.
 *
 */
@Module({
  imports: [
    // Register all billing and cross-domain insurance entities for TypeORM
    TypeOrmModule.forFeature([
      // Billing domain entities
      PatientBill,
      BillItem,
      Payment,
      PaymentMethod,
      Invoice,
      Receipt,
      Discount,
      Tax,
      PricingStrategy,
      BillingTransaction,
      // Insurance domain entities (cross-domain access)
      InsuranceClaim,
      InsuranceClaimItem,
      InsuranceProvider,
      InsuranceScheme,
      PatientInsurance,
      InsuranceContract,
    ]),
    DatabaseModule,
    LoggerModule,
    SecurityModule,
    AuditModule,
    Aes256Module.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        key: config.getOrThrow<string>('ENCRYPTION_KEY'),
        salt: config.getOrThrow<string>('ENCRYPTION_SALT'),
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    // ─── Services ────────────────────────────────────────────────────────
    BillService,
    PaymentService,
    InvoiceService,
    DiscountService,
    TaxService,
    InsuranceClaimService,
    BillingOrchestrationService,
    BillingAnalyticsService,
    InsuranceDropdownService,
    ClaimPdfService,

    // ─── Strategies ──────────────────────────────────────────────────────
    BillingStrategyFactory,
    DispenseBillingStrategy,
    ServiceBillingStrategy,
    ReturnBillingStrategy,
    AdjustmentBillingStrategy,

    // ─── Repository Factories ────────────────────────────────────────────
    // Each billing repository extends Repository<T> and requires DataSource
    // and LoggerService in its constructor. We use the factory pattern for
    // consistent repository instantiation across the domain.

    {
      provide: PatientBillRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new PatientBillRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
    {
      provide: BillItemRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new BillItemRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
    {
      provide: PaymentRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new PaymentRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
    {
      provide: PaymentMethodRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new PaymentMethodRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
    {
      provide: InvoiceRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new InvoiceRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
    {
      provide: ReceiptRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new ReceiptRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
    {
      provide: DiscountRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new DiscountRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
    {
      provide: TaxRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new TaxRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
    {
      provide: PricingStrategyRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new PricingStrategyRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
    {
      provide: BillingTransactionRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new BillingTransactionRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
  ],
  controllers: [
    BillController,
    InsuranceClaimController,
    InsuranceClaimPdfController,
    InsuranceDropdownController,
  ],
  exports: [
    // Export services for use by other domains
    BillService,
    PaymentService,
    InvoiceService,
    DiscountService,
    TaxService,
    InsuranceClaimService,
    BillingOrchestrationService,
    BillingAnalyticsService,
    InsuranceDropdownService,
    ClaimPdfService,

    // Export strategies for orchestration
    BillingStrategyFactory,
    DispenseBillingStrategy,
    ServiceBillingStrategy,
    ReturnBillingStrategy,
    AdjustmentBillingStrategy,

    // Export repositories for direct access from other domains
    PatientBillRepository,
    BillItemRepository,
    PaymentRepository,
    PaymentMethodRepository,
    InvoiceRepository,
    ReceiptRepository,
    DiscountRepository,
    TaxRepository,
    PricingStrategyRepository,
    BillingTransactionRepository,

    // Export TypeOrmModule for entity access
    TypeOrmModule,
  ],
})
export class BillingModule {}
