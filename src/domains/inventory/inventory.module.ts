import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

// Entities
import { InventoryCategory } from './entities/inventory-category.entity';
import { Supplier } from './entities/supplier.entity';
import { MedicationItem } from './entities/medication-item.entity';
import { ConsumableItem } from './entities/consumable-item.entity';
import { Batch } from './entities/batch.entity';
import { MedicationMovement } from './entities/medication-movement.entity';
import { ConsumableMovement } from './entities/consumable-movement.entity';
import { MedicationAdjustment } from './entities/medication-adjustment.entity';
import { ConsumableAdjustment } from './entities/consumable-adjustment.entity';
import { MedicationSale } from './entities/medication-sale.entity';
import { MedicationPartialSale } from './entities/medication-partial-sale.entity';
import { ConsumableUsage } from './entities/consumable-usage.entity';
import { ConsumablePartialUsage } from './entities/consumable-partial-usage.entity';
import { InventoryAudit } from './entities/inventory-audit.entity';

// Repositories
import { MedicationItemRepository } from './repositories/medication-item.repository';
import { ConsumableItemRepository } from './repositories/consumable-item.repository';
import { BatchRepository } from './repositories/batch.repository';
import { CategoryRepository } from './repositories/category.repository';
import { SupplierRepository } from './repositories/supplier.repository';
import { InventoryAuditRepository } from './repositories/inventory-audit.repository';

// Services
import { MedicationItemService } from './services/medication-item.service';
import { ConsumableItemService } from './services/consumable-item.service';
import { BatchService } from './services/batch.service';
import { CategoryService } from './services/category.service';
import { SupplierService } from './services/supplier.service';
import { InventoryAuditService } from './services/inventory-audit.service';
import { DispenseService } from './services/dispense.service';
import { TransactionManagerService } from './services/transaction-manager.service';
import { InventoryDropdownService } from './services/dropdown.service';

// Strategies
import { BatchSelectionService } from './strategies/batch-selection/batch-selection.service';
import { MovementStrategyContext } from './strategies/movement/movement-strategy.context';
import { AdjustmentStrategyContext } from './strategies/adjustment/adjustment-strategy.context';

// Common modules
import { LoggerModule } from '../../common/logger/logger.module';
import { LoggerService } from '../../common/logger/logger.service';
import { Aes256Module } from '../../common/security/encryption/aes-256.module';
import { Aes256Service } from '../../common/security/encryption/aes-256.service';
import { DatabaseModule } from '../../common/database/database.module';
import { SecurityModule } from '../../common/security/security.module';

// Audit module
import { AuditModule } from '../audit/audit.module';

// ─── Controllers ──────────────────────────────────────────────────────────────
import { MedicationItemController }  from './controllers/medication-item.controller';
import { ConsumableItemController }  from './controllers/consumable-item.controller';
import { CategoryController }        from './controllers/category.controller';
import { BatchController }           from './controllers/batch.controller';
import { SupplierController }        from './controllers/supplier.controller';
import { DispenseController }        from './controllers/dispense.controller';
import { InventoryAuditController }  from './controllers/inventory-audit.controller';
import { InventoryDropdownController } from './controllers/dropdown.controller';

/**
 * Inventory Domain Module
 * Manages medication and consumable inventory with:
 * - Multi-tenancy (workspaceId scoping on all entities)
 * - Encrypted field support (via EncryptedRepository)
 * - FEFO/OptimalCost/Emergency batch selection strategies
 * - Movement and adjustment tracking
 * - Partial dispense / split-unit management
 * - HIPAA-compliant audit logging
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      InventoryCategory,
      Supplier,
      MedicationItem,
      ConsumableItem,
      Batch,
      MedicationMovement,
      ConsumableMovement,
      MedicationAdjustment,
      ConsumableAdjustment,
      MedicationSale,
      MedicationPartialSale,
      ConsumableUsage,
      ConsumablePartialUsage,
      InventoryAudit,
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
  controllers: [
    MedicationItemController,
    ConsumableItemController,
    CategoryController,
    BatchController,
    SupplierController,
    DispenseController,
    InventoryAuditController,
    InventoryDropdownController,
  ],
  providers: [
    // ─── Services ──────────────────────────────────────────────────────
    MedicationItemService,
    ConsumableItemService,
    BatchService,
    CategoryService,
    SupplierService,
    InventoryAuditService,
    DispenseService,
    TransactionManagerService,
    InventoryDropdownService,

    // ─── Strategies ────────────────────────────────────────────────────
    BatchSelectionService,
    MovementStrategyContext,
    AdjustmentStrategyContext,

    // ─── Repositories (Factory Pattern) ────────────────────────────────
    {
      provide: MedicationItemRepository,
      useFactory: (dataSource: DataSource, aesService: Aes256Service, loggerService: LoggerService) => {
        return new MedicationItemRepository(dataSource, aesService, loggerService);
      },
      inject: [DataSource, Aes256Service, LoggerService],
    },
    {
      provide: ConsumableItemRepository,
      useFactory: (dataSource: DataSource, aesService: Aes256Service, loggerService: LoggerService) => {
        return new ConsumableItemRepository(dataSource, aesService, loggerService);
      },
      inject: [DataSource, Aes256Service, LoggerService],
    },
    {
      provide: BatchRepository,
      useFactory: (dataSource: DataSource, aesService: Aes256Service, loggerService: LoggerService) => {
        return new BatchRepository(dataSource, aesService, loggerService);
      },
      inject: [DataSource, Aes256Service, LoggerService],
    },
    {
      provide: SupplierRepository,
      useFactory: (dataSource: DataSource, aesService: Aes256Service, loggerService: LoggerService) => {
        return new SupplierRepository(dataSource, aesService, loggerService);
      },
      inject: [DataSource, Aes256Service, LoggerService],
    },
    {
      provide: CategoryRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new CategoryRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
    {
      provide: InventoryAuditRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new InventoryAuditRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
  ],
  exports: [
    // Services
    MedicationItemService,
    ConsumableItemService,
    BatchService,
    CategoryService,
    SupplierService,
    InventoryAuditService,
    DispenseService,
    TransactionManagerService,
    InventoryDropdownService,

    // Strategies
    BatchSelectionService,
    MovementStrategyContext,
    AdjustmentStrategyContext,

    // Repositories
    MedicationItemRepository,
    ConsumableItemRepository,
    BatchRepository,
    CategoryRepository,
    SupplierRepository,
    InventoryAuditRepository,

    // TypeORM entity access
    TypeOrmModule,
  ],
})
export class InventoryModule {}
