import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBillingDomain1740700000005 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. discounts (standalone)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`discounts\` (
        \`id\` varchar(36) NOT NULL,
        \`name\` varchar(255) NOT NULL,
        \`description\` text DEFAULT NULL,
        \`type\` enum('PERCENTAGE','FIXED_AMOUNT') NOT NULL,
        \`value\` decimal(10,2) NOT NULL,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        \`validFrom\` date DEFAULT NULL,
        \`validTo\` date DEFAULT NULL,
        \`eligibilityCriteria\` longtext DEFAULT NULL,
        \`priority\` int(11) NOT NULL DEFAULT 1,
        \`usageCount\` int(11) NOT NULL DEFAULT 0,
        \`totalDiscountAmount\` decimal(10,2) NOT NULL DEFAULT 0.00,
        \`maxUsageCount\` int(11) NOT NULL DEFAULT 0,
        \`maxTotalDiscountAmount\` decimal(12,2) DEFAULT NULL,
        \`isAutoApplicable\` tinyint(4) NOT NULL DEFAULT 0,
        \`discountCode\` varchar(50) DEFAULT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`deletedAt\` datetime(6) DEFAULT NULL,
        \`metadata\` longtext DEFAULT NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);

    // 2. taxes (standalone)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`taxes\` (
        \`id\` varchar(36) NOT NULL,
        \`name\` varchar(255) NOT NULL,
        \`description\` text DEFAULT NULL,
        \`rate\` decimal(5,2) NOT NULL,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        \`validFrom\` date DEFAULT NULL,
        \`validTo\` date DEFAULT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`applicability\` longtext DEFAULT NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);

    // 3. pricing_strategies (standalone)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`pricing_strategies\` (
        \`id\` varchar(36) NOT NULL,
        \`name\` varchar(255) NOT NULL,
        \`description\` text DEFAULT NULL,
        \`type\` enum('COST_PLUS','MARKET_BASED','INSURANCE_CONTRACT','VOLUME_DISCOUNT','TIERED_PRICING','PATIENT_CATEGORY') NOT NULL,
        \`rules\` longtext DEFAULT NULL,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        \`validFrom\` date DEFAULT NULL,
        \`validTo\` date DEFAULT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`priorityRules\` longtext DEFAULT NULL,
        \`metadata\` longtext DEFAULT NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);

    // 4. payment_methods (standalone)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`payment_methods\` (
        \`id\` varchar(36) NOT NULL,
        \`type\` enum('CASH','CREDIT_CARD','DEBIT_CARD','BANK_TRANSFER','CHEQUE','INSURANCE','MOBILE_MONEY','ONLINE','HMO','CORPORATE','VOUCHER','OTHER') NOT NULL DEFAULT 'CASH',
        \`name\` varchar(255) NOT NULL,
        \`description\` varchar(255) DEFAULT NULL,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        \`processingFeePercentage\` decimal(5,2) DEFAULT NULL,
        \`minAmount\` decimal(12,2) DEFAULT NULL,
        \`maxAmount\` decimal(12,2) DEFAULT NULL,
        \`configuration\` longtext DEFAULT NULL,
        \`sortOrder\` int(11) NOT NULL DEFAULT 0,
        \`icon\` varchar(50) DEFAULT NULL,
        \`color\` varchar(10) DEFAULT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`metadata\` longtext DEFAULT NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);

    // 5. patient_bills (without FK constraints inline)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`patient_bills\` (
        \`id\` varchar(36) NOT NULL,
        \`billNumber\` varchar(255) NOT NULL,
        \`patientId\` varchar(255) NOT NULL,
        \`appointmentId\` varchar(255) NOT NULL,
        \`department\` varchar(255) DEFAULT NULL,
        \`discountId\` varchar(255) DEFAULT NULL,
        \`taxId\` varchar(255) DEFAULT NULL,
        \`subtotal\` decimal(10,2) NOT NULL DEFAULT 0.00,
        \`total\` decimal(10,2) NOT NULL DEFAULT 0.00,
        \`discountAmount\` decimal(10,2) NOT NULL DEFAULT 0.00,
        \`taxAmount\` decimal(10,2) NOT NULL DEFAULT 0.00,
        \`status\` enum('DRAFT','PENDING','PARTIALLY_PAID','PAID','OVERDUE','CANCELLED','REFUNDED','VOIDED','PARTIAL') NOT NULL DEFAULT 'PENDING',
        \`issuedAt\` datetime NOT NULL,
        \`dueDate\` datetime DEFAULT NULL,
        \`notes\` text DEFAULT NULL,
        \`metadata\` longtext DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`IDX_12e5cea58f9988bea06a8ce4aa\` (\`billNumber\`),
        UNIQUE KEY \`REL_77a085364ff3ff426cb87b7826\` (\`appointmentId\`),
        KEY \`FK_a20c37b9dc0f3f3e76561650c28\` (\`patientId\`),
        KEY \`FK_3974cd37c9b1820dd01d5dcb4e5\` (\`discountId\`),
        KEY \`FK_b76ccdefe98d69dfa5b09d74582\` (\`taxId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);

    // patient_bills FK constraints
    await queryRunner.query(`
      ALTER TABLE \`patient_bills\` ADD CONSTRAINT \`FK_a20c37b9dc0f3f3e76561650c28\` FOREIGN KEY (\`patientId\`) REFERENCES \`patients\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION;
    `);

    await queryRunner.query(`
      ALTER TABLE \`patient_bills\` ADD CONSTRAINT \`FK_77a085364ff3ff426cb87b78266\` FOREIGN KEY (\`appointmentId\`) REFERENCES \`appointments\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION;
    `);

    await queryRunner.query(`
      ALTER TABLE \`patient_bills\` ADD CONSTRAINT \`FK_3974cd37c9b1820dd01d5dcb4e5\` FOREIGN KEY (\`discountId\`) REFERENCES \`discounts\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION;
    `);

    await queryRunner.query(`
      ALTER TABLE \`patient_bills\` ADD CONSTRAINT \`FK_b76ccdefe98d69dfa5b09d74582\` FOREIGN KEY (\`taxId\`) REFERENCES \`taxes\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION;
    `);

    // 6. bill_items (without FK constraints inline)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`bill_items\` (
        \`id\` varchar(36) NOT NULL,
        \`billId\` varchar(255) NOT NULL,
        \`description\` varchar(255) NOT NULL,
        \`quantity\` decimal(12,4) NOT NULL,
        \`unitPrice\` decimal(12,2) NOT NULL,
        \`total\` decimal(12,2) NOT NULL,
        \`department\` varchar(255) DEFAULT NULL,
        \`medicationItemId\` varchar(255) DEFAULT NULL,
        \`consumableItemId\` varchar(255) DEFAULT NULL,
        \`batchId\` varchar(255) DEFAULT NULL,
        \`actualUnitCost\` decimal(12,2) DEFAULT NULL,
        \`hasInsuranceClaim\` tinyint(4) DEFAULT NULL,
        \`insuranceClaimStatus\` enum('NOT_CLAIMED','CLAIMED','PENDING','PARTIALLY_APPROVED','FULLY_APPROVED','DENIED','ADJUSTED','APPEALED','WRITTEN_OFF','CANCELLED') NOT NULL DEFAULT 'NOT_CLAIMED',
        \`totalClaimedAmount\` decimal(10,2) NOT NULL DEFAULT 0.00,
        \`totalApprovedAmount\` decimal(10,2) NOT NULL DEFAULT 0.00,
        \`totalDeniedAmount\` decimal(10,2) NOT NULL DEFAULT 0.00,
        \`metadata\` longtext DEFAULT NULL,
        \`createdAt\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`updatedAt\` timestamp NOT NULL DEFAULT current_timestamp(),
        PRIMARY KEY (\`id\`),
        KEY \`FK_b58e05ac79f151ff015d70e122e\` (\`billId\`),
        KEY \`FK_08d331754b2bd2127f9f7f9e94e\` (\`medicationItemId\`),
        KEY \`FK_9ae474070fcb6c4ba5f42dbcdd3\` (\`consumableItemId\`),
        KEY \`FK_dd5dd0d2ca9860738e755b743b2\` (\`batchId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);

    // bill_items FK constraints
    await queryRunner.query(`
      ALTER TABLE \`bill_items\` ADD CONSTRAINT \`FK_b58e05ac79f151ff015d70e122e\` FOREIGN KEY (\`billId\`) REFERENCES \`patient_bills\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION;
    `);

    await queryRunner.query(`
      ALTER TABLE \`bill_items\` ADD CONSTRAINT \`FK_08d331754b2bd2127f9f7f9e94e\` FOREIGN KEY (\`medicationItemId\`) REFERENCES \`medication_items\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION;
    `);

    await queryRunner.query(`
      ALTER TABLE \`bill_items\` ADD CONSTRAINT \`FK_9ae474070fcb6c4ba5f42dbcdd3\` FOREIGN KEY (\`consumableItemId\`) REFERENCES \`consumable_items\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION;
    `);

    await queryRunner.query(`
      ALTER TABLE \`bill_items\` ADD CONSTRAINT \`FK_dd5dd0d2ca9860738e755b743b2\` FOREIGN KEY (\`batchId\`) REFERENCES \`batches\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION;
    `);

    // 7. billing_transactions (without FK constraints inline)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`billing_transactions\` (
        \`id\` varchar(36) NOT NULL,
        \`batchId\` varchar(255) NOT NULL,
        \`billItemId\` varchar(255) DEFAULT NULL,
        \`actualUnitCost\` decimal(10,2) NOT NULL,
        \`actualSellingPrice\` decimal(10,2) NOT NULL,
        \`quantity\` decimal(10,4) NOT NULL,
        \`totalCost\` decimal(12,2) NOT NULL,
        \`totalPrice\` decimal(12,2) NOT NULL,
        \`profitMargin\` decimal(12,2) NOT NULL,
        \`transactionType\` varchar(50) NOT NULL,
        \`patientId\` varchar(255) DEFAULT NULL,
        \`referenceNumber\` varchar(100) DEFAULT NULL,
        \`notes\` text DEFAULT NULL,
        \`transactionDate\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`createdAt\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`metadata\` longtext DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`FK_fbbd1a27d9691a35632f65680f2\` (\`batchId\`),
        KEY \`FK_bc1de734e31ade2d4768a69952a\` (\`billItemId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);

    // billing_transactions FK constraints
    await queryRunner.query(`
      ALTER TABLE \`billing_transactions\` ADD CONSTRAINT \`FK_fbbd1a27d9691a35632f65680f2\` FOREIGN KEY (\`batchId\`) REFERENCES \`batches\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION;
    `);

    await queryRunner.query(`
      ALTER TABLE \`billing_transactions\` ADD CONSTRAINT \`FK_bc1de734e31ade2d4768a69952a\` FOREIGN KEY (\`billItemId\`) REFERENCES \`bill_items\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION;
    `);

    // 8. payments (without FK constraints inline)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`payments\` (
        \`id\` varchar(36) NOT NULL,
        \`paymentReference\` varchar(255) NOT NULL,
        \`billId\` varchar(255) NOT NULL,
        \`patientId\` varchar(255) NOT NULL,
        \`paymentMethodId\` varchar(255) NOT NULL,
        \`processingFeePercentage\` decimal(5,2) DEFAULT NULL,
        \`amount\` decimal(12,2) NOT NULL,
        \`processingFee\` decimal(10,2) NOT NULL DEFAULT 0.00,
        \`netAmount\` decimal(12,2) NOT NULL,
        \`status\` enum('PENDING','COMPLETED','FAILED','REFUNDED','PARTIALLY_REFUNDED','PROCESSING','CANCELLED','DECLINED') NOT NULL DEFAULT 'PENDING',
        \`transactionId\` varchar(255) DEFAULT NULL,
        \`chequeNumber\` varchar(255) DEFAULT NULL,
        \`bankName\` varchar(255) DEFAULT NULL,
        \`accountNumber\` varchar(255) DEFAULT NULL,
        \`cardLastFour\` varchar(255) DEFAULT NULL,
        \`cardType\` varchar(50) DEFAULT NULL,
        \`authorizationCode\` varchar(100) DEFAULT NULL,
        \`insuranceProvider\` varchar(255) DEFAULT NULL,
        \`insurancePolicyNumber\` varchar(255) DEFAULT NULL,
        \`authorizationNumber\` varchar(255) DEFAULT NULL,
        \`paymentDate\` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
        \`processedAt\` timestamp NULL DEFAULT NULL,
        \`refundedAt\` timestamp NULL DEFAULT NULL,
        \`failedAt\` timestamp NULL DEFAULT NULL,
        \`notes\` text DEFAULT NULL,
        \`failureReason\` text DEFAULT NULL,
        \`paymentDetails\` longtext DEFAULT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`metadata\` longtext DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`IDX_609e73477743140ae29ae6de48\` (\`paymentReference\`),
        KEY \`FK_566f88b54bf6a0f477b14e8daa5\` (\`billId\`),
        KEY \`FK_e1f738d342393a3c19867610f20\` (\`patientId\`),
        KEY \`FK_cbe18cae039006a9c217d5a66a6\` (\`paymentMethodId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);

    // payments FK constraints
    await queryRunner.query(`
      ALTER TABLE \`payments\` ADD CONSTRAINT \`FK_566f88b54bf6a0f477b14e8daa5\` FOREIGN KEY (\`billId\`) REFERENCES \`patient_bills\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION;
    `);

    await queryRunner.query(`
      ALTER TABLE \`payments\` ADD CONSTRAINT \`FK_e1f738d342393a3c19867610f20\` FOREIGN KEY (\`patientId\`) REFERENCES \`patients\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION;
    `);

    await queryRunner.query(`
      ALTER TABLE \`payments\` ADD CONSTRAINT \`FK_cbe18cae039006a9c217d5a66a6\` FOREIGN KEY (\`paymentMethodId\`) REFERENCES \`payment_methods\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION;
    `);

    // 9. invoices (without FK constraints inline)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`invoices\` (
        \`id\` varchar(36) NOT NULL,
        \`invoiceNumber\` varchar(255) NOT NULL,
        \`billId\` varchar(255) NOT NULL,
        \`patientId\` varchar(255) NOT NULL,
        \`type\` enum('STANDARD','PRO_FORMA','CREDIT','DEBIT','MIXED') NOT NULL DEFAULT 'STANDARD',
        \`status\` enum('DRAFT','ISSUED','SENT','PAID','PARTIALLY_PAID','OVERDUE','CANCELLED','REFUNDED','VOIDED','PENDING') NOT NULL DEFAULT 'PENDING',
        \`issueDate\` date NOT NULL,
        \`dueDate\` date NOT NULL,
        \`amount\` decimal(12,2) NOT NULL,
        \`amountPaid\` decimal(10,2) NOT NULL DEFAULT 0.00,
        \`balance\` decimal(10,2) NOT NULL DEFAULT 0.00,
        \`notes\` text DEFAULT NULL,
        \`items\` longtext DEFAULT NULL,
        \`metadata\` longtext DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`IDX_bf8e0f9dd4558ef209ec111782\` (\`invoiceNumber\`),
        KEY \`FK_ccccd755c72a68993cd013fba08\` (\`billId\`),
        KEY \`FK_7f1f96ee217edce59c605cc9380\` (\`patientId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);

    // invoices FK constraints
    await queryRunner.query(`
      ALTER TABLE \`invoices\` ADD CONSTRAINT \`FK_ccccd755c72a68993cd013fba08\` FOREIGN KEY (\`billId\`) REFERENCES \`patient_bills\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION;
    `);

    await queryRunner.query(`
      ALTER TABLE \`invoices\` ADD CONSTRAINT \`FK_7f1f96ee217edce59c605cc9380\` FOREIGN KEY (\`patientId\`) REFERENCES \`patients\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION;
    `);

    // 10. receipts (without FK constraints inline)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`receipts\` (
        \`id\` varchar(36) NOT NULL,
        \`receiptNumber\` varchar(255) NOT NULL,
        \`paymentId\` varchar(255) NOT NULL,
        \`patientId\` varchar(255) NOT NULL,
        \`amount\` decimal(12,2) NOT NULL,
        \`paymentDate\` datetime NOT NULL,
        \`paymentMethod\` varchar(255) NOT NULL,
        \`notes\` text DEFAULT NULL,
        \`items\` longtext DEFAULT NULL,
        \`metadata\` longtext DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`IDX_ae91d6f7ca67ed5bf73177430d\` (\`receiptNumber\`),
        KEY \`FK_1a1d2f3a4c9d21b263ca8ff63e8\` (\`paymentId\`),
        KEY \`FK_e805f2f90bd219c62656b05a95d\` (\`patientId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);

    // receipts FK constraints
    await queryRunner.query(`
      ALTER TABLE \`receipts\` ADD CONSTRAINT \`FK_1a1d2f3a4c9d21b263ca8ff63e8\` FOREIGN KEY (\`paymentId\`) REFERENCES \`payments\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION;
    `);

    await queryRunner.query(`
      ALTER TABLE \`receipts\` ADD CONSTRAINT \`FK_e805f2f90bd219c62656b05a95d\` FOREIGN KEY (\`patientId\`) REFERENCES \`patients\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop FK constraints first (reverse order of tables)

    // receipts FKs
    await queryRunner.query(`
      ALTER TABLE \`receipts\` DROP FOREIGN KEY \`FK_1a1d2f3a4c9d21b263ca8ff63e8\`;
    `);

    await queryRunner.query(`
      ALTER TABLE \`receipts\` DROP FOREIGN KEY \`FK_e805f2f90bd219c62656b05a95d\`;
    `);

    // invoices FKs
    await queryRunner.query(`
      ALTER TABLE \`invoices\` DROP FOREIGN KEY \`FK_ccccd755c72a68993cd013fba08\`;
    `);

    await queryRunner.query(`
      ALTER TABLE \`invoices\` DROP FOREIGN KEY \`FK_7f1f96ee217edce59c605cc9380\`;
    `);

    // payments FKs
    await queryRunner.query(`
      ALTER TABLE \`payments\` DROP FOREIGN KEY \`FK_566f88b54bf6a0f477b14e8daa5\`;
    `);

    await queryRunner.query(`
      ALTER TABLE \`payments\` DROP FOREIGN KEY \`FK_e1f738d342393a3c19867610f20\`;
    `);

    await queryRunner.query(`
      ALTER TABLE \`payments\` DROP FOREIGN KEY \`FK_cbe18cae039006a9c217d5a66a6\`;
    `);

    // billing_transactions FKs
    await queryRunner.query(`
      ALTER TABLE \`billing_transactions\` DROP FOREIGN KEY \`FK_fbbd1a27d9691a35632f65680f2\`;
    `);

    await queryRunner.query(`
      ALTER TABLE \`billing_transactions\` DROP FOREIGN KEY \`FK_bc1de734e31ade2d4768a69952a\`;
    `);

    // bill_items FKs
    await queryRunner.query(`
      ALTER TABLE \`bill_items\` DROP FOREIGN KEY \`FK_b58e05ac79f151ff015d70e122e\`;
    `);

    await queryRunner.query(`
      ALTER TABLE \`bill_items\` DROP FOREIGN KEY \`FK_08d331754b2bd2127f9f7f9e94e\`;
    `);

    await queryRunner.query(`
      ALTER TABLE \`bill_items\` DROP FOREIGN KEY \`FK_9ae474070fcb6c4ba5f42dbcdd3\`;
    `);

    await queryRunner.query(`
      ALTER TABLE \`bill_items\` DROP FOREIGN KEY \`FK_dd5dd0d2ca9860738e755b743b2\`;
    `);

    // patient_bills FKs
    await queryRunner.query(`
      ALTER TABLE \`patient_bills\` DROP FOREIGN KEY \`FK_a20c37b9dc0f3f3e76561650c28\`;
    `);

    await queryRunner.query(`
      ALTER TABLE \`patient_bills\` DROP FOREIGN KEY \`FK_77a085364ff3ff426cb87b78266\`;
    `);

    await queryRunner.query(`
      ALTER TABLE \`patient_bills\` DROP FOREIGN KEY \`FK_3974cd37c9b1820dd01d5dcb4e5\`;
    `);

    await queryRunner.query(`
      ALTER TABLE \`patient_bills\` DROP FOREIGN KEY \`FK_b76ccdefe98d69dfa5b09d74582\`;
    `);

    // Drop tables in reverse order
    await queryRunner.query(`DROP TABLE IF EXISTS \`receipts\`;`);

    await queryRunner.query(`DROP TABLE IF EXISTS \`invoices\`;`);

    await queryRunner.query(`DROP TABLE IF EXISTS \`payments\`;`);

    await queryRunner.query(`DROP TABLE IF EXISTS \`billing_transactions\`;`);

    await queryRunner.query(`DROP TABLE IF EXISTS \`bill_items\`;`);

    await queryRunner.query(`DROP TABLE IF EXISTS \`patient_bills\`;`);

    await queryRunner.query(`DROP TABLE IF EXISTS \`payment_methods\`;`);

    await queryRunner.query(`DROP TABLE IF EXISTS \`pricing_strategies\`;`);

    await queryRunner.query(`DROP TABLE IF EXISTS \`taxes\`;`);

    await queryRunner.query(`DROP TABLE IF EXISTS \`discounts\`;`);
  }
}
