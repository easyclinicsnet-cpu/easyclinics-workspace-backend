import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInventoryDomain1740700000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. suppliers
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`suppliers\` (
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`deletedAt\` datetime(6) DEFAULT NULL,
        \`deletedBy\` varchar(255) DEFAULT NULL,
        \`isDeleted\` tinyint(4) NOT NULL DEFAULT 0,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        \`id\` varchar(36) NOT NULL,
        \`code\` varchar(255) NOT NULL,
        \`name\` varchar(255) NOT NULL,
        \`description\` text DEFAULT NULL,
        \`contactPerson\` varchar(255) NOT NULL,
        \`email\` varchar(255) NOT NULL,
        \`phone\` varchar(255) NOT NULL,
        \`address\` text NOT NULL,
        \`taxIdentificationNumber\` varchar(255) DEFAULT NULL,
        \`paymentTerms\` longtext DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`IDX_6f01a03dcb1aa33822e19534cd\` (\`code\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 2. inventory_categories
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`inventory_categories\` (
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`deletedAt\` datetime(6) DEFAULT NULL,
        \`deletedBy\` varchar(255) DEFAULT NULL,
        \`isDeleted\` tinyint(4) NOT NULL DEFAULT 0,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        \`id\` varchar(36) NOT NULL,
        \`code\` varchar(255) NOT NULL,
        \`name\` varchar(255) NOT NULL,
        \`description\` text DEFAULT NULL,
        \`defaultUnit\` varchar(255) DEFAULT NULL,
        \`parentId\` varchar(255) DEFAULT NULL,
        \`type\` enum('medication','consumable') NOT NULL DEFAULT 'medication',
        \`storageConditions\` longtext DEFAULT NULL,
        \`requiresPrescriptionDefault\` tinyint(4) NOT NULL DEFAULT 0,
        \`isControlledDefault\` tinyint(4) NOT NULL DEFAULT 0,
        \`mpath\` varchar(255) DEFAULT '',
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`IDX_3f956dbcfc0b22b2f64dcaab7c\` (\`code\`),
        KEY \`IDX_58bcb7da9b8fb06aa8a8f34aae\` (\`name\`),
        KEY \`FK_e8fe592f0f5f048e185c88e9646\` (\`parentId\`),
        CONSTRAINT \`FK_e8fe592f0f5f048e185c88e9646\` FOREIGN KEY (\`parentId\`) REFERENCES \`inventory_categories\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 3. medication_items
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`medication_items\` (
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`deletedAt\` datetime(6) DEFAULT NULL,
        \`deletedBy\` varchar(255) DEFAULT NULL,
        \`isDeleted\` tinyint(4) NOT NULL DEFAULT 0,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        \`id\` varchar(36) NOT NULL,
        \`code\` varchar(255) NOT NULL,
        \`name\` varchar(255) NOT NULL,
        \`description\` text DEFAULT NULL,
        \`type\` enum('medication','consumable') NOT NULL,
        \`totalQuantity\` decimal(14,4) NOT NULL DEFAULT 0.0000,
        \`availableQuantity\` decimal(14,4) NOT NULL DEFAULT 0.0000,
        \`reservedQuantity\` decimal(14,4) NOT NULL DEFAULT 0.0000,
        \`minimumStockLevel\` decimal(14,4) NOT NULL DEFAULT 0.0000,
        \`reorderQuantity\` decimal(14,4) NOT NULL DEFAULT 0.0000,
        \`totalPackCount\` decimal(10,0) NOT NULL DEFAULT 0,
        \`trackInBaseUnits\` tinyint(4) NOT NULL DEFAULT 0,
        \`form\` enum('SOLID','LIQUID','GAS','SEMI_SOLID','POWDER','OTHER') DEFAULT NULL,
        \`barcode\` varchar(255) DEFAULT NULL,
        \`unitOfMeasure\` enum('TABLET','CAPSULE','CAPLET','PILL','LOZENGE','SUPPOSITORY','OVULE','PATCH','SACHET','POWDER','GRANULE','ML','LITER','DROP','TEASPOON','TABLESPOON','SPRAY','PUFF','DOSE','VIAL','AMP','SYRINGE','CARTRIDGE','PEN','TUBE','JAR','CANISTER','BOTTLE','POUCH','SWAB','WAFER','FILM','STRIP','KG','G','MG','MCG','NG','IU','UNIT','MEQ','MMOL','PACK','KIT','BOX','BLISTER','STRIP_PACK','CARTON','GALLON','FL_OZ','CUP','INHALER','NEBULE','CAN','APPLICATION','ACTUATION','SERVING','BATCH','OTHER') DEFAULT NULL,
        \`unitCost\` decimal(10,2) NOT NULL,
        \`sellingPrice\` decimal(10,2) DEFAULT NULL,
        \`baseUnitPrice\` decimal(10,4) DEFAULT NULL,
        \`requiresPrescription\` tinyint(4) NOT NULL DEFAULT 0,
        \`isControlledSubstance\` tinyint(4) NOT NULL DEFAULT 0,
        \`isHighRisk\` tinyint(4) NOT NULL DEFAULT 0,
        \`isSingleUse\` tinyint(4) NOT NULL DEFAULT 0,
        \`isSterile\` tinyint(4) NOT NULL DEFAULT 0,
        \`isSplittable\` tinyint(4) NOT NULL DEFAULT 0,
        \`basePackSize\` decimal(10,4) DEFAULT NULL,
        \`basePackUnit\` varchar(20) DEFAULT NULL,
        \`minimumDispenseQuantity\` decimal(10,4) DEFAULT NULL,
        \`useOpenedPacksFirst\` tinyint(4) NOT NULL DEFAULT 1,
        \`splitUnits\` longtext DEFAULT NULL,
        \`materialComposition\` longtext DEFAULT NULL,
        \`storageConditions\` longtext DEFAULT NULL,
        \`storageOverrides\` longtext DEFAULT NULL,
        \`metadata\` longtext DEFAULT NULL,
        \`categoryId\` varchar(255) NOT NULL,
        \`supplierId\` varchar(255) DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`IDX_d2d75c2795c5a72b50deea4f4c\` (\`code\`),
        KEY \`FK_b9a543bfe4b1b063fa0cf045deb\` (\`categoryId\`),
        KEY \`FK_9a77d78f75a58f0f5ac94668fa6\` (\`supplierId\`),
        CONSTRAINT \`FK_b9a543bfe4b1b063fa0cf045deb\` FOREIGN KEY (\`categoryId\`) REFERENCES \`inventory_categories\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT \`FK_9a77d78f75a58f0f5ac94668fa6\` FOREIGN KEY (\`supplierId\`) REFERENCES \`suppliers\` (\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 4. consumable_items
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`consumable_items\` (
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`deletedAt\` datetime(6) DEFAULT NULL,
        \`deletedBy\` varchar(255) DEFAULT NULL,
        \`isDeleted\` tinyint(4) NOT NULL DEFAULT 0,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        \`id\` varchar(36) NOT NULL,
        \`code\` varchar(255) NOT NULL,
        \`name\` varchar(255) NOT NULL,
        \`description\` text DEFAULT NULL,
        \`type\` enum('medication','consumable') NOT NULL,
        \`totalQuantity\` decimal(14,4) NOT NULL DEFAULT 0.0000,
        \`availableQuantity\` decimal(14,4) NOT NULL DEFAULT 0.0000,
        \`reservedQuantity\` decimal(14,4) NOT NULL DEFAULT 0.0000,
        \`minimumStockLevel\` decimal(14,4) NOT NULL DEFAULT 0.0000,
        \`reorderQuantity\` decimal(14,4) NOT NULL DEFAULT 0.0000,
        \`totalPackCount\` decimal(10,0) NOT NULL DEFAULT 0,
        \`trackInBaseUnits\` tinyint(4) NOT NULL DEFAULT 0,
        \`form\` enum('SOLID','LIQUID','GAS','SEMI_SOLID','POWDER','OTHER') DEFAULT NULL,
        \`barcode\` varchar(255) DEFAULT NULL,
        \`unitOfMeasure\` enum('PIECE','BOX','CARTON','PACK','VIAL','BOTTLE','TUBE','SACHET','AMPULE','BAG','ROLL','SHEET','PAIR','DOZEN','TRAY','KIT','SET','CAN','BARREL','LITER','MILLILITER','GRAM','KILOGRAM','METER','CENTIMETER','MILLIMETER','OTHER') DEFAULT NULL,
        \`unitCost\` decimal(10,2) NOT NULL,
        \`sellingPrice\` decimal(10,2) DEFAULT NULL,
        \`baseUnitPrice\` decimal(10,4) DEFAULT NULL,
        \`isSingleUse\` tinyint(4) NOT NULL DEFAULT 0,
        \`isSterile\` tinyint(4) NOT NULL DEFAULT 0,
        \`isDisposable\` tinyint(4) NOT NULL DEFAULT 0,
        \`isReusable\` tinyint(4) NOT NULL DEFAULT 0,
        \`requiresSterilization\` tinyint(4) NOT NULL DEFAULT 0,
        \`isSplittable\` tinyint(4) NOT NULL DEFAULT 0,
        \`basePackSize\` decimal(10,4) DEFAULT NULL,
        \`basePackUnit\` varchar(20) DEFAULT NULL,
        \`minimumDispenseQuantity\` decimal(10,4) DEFAULT NULL,
        \`useOpenedPacksFirst\` tinyint(4) NOT NULL DEFAULT 1,
        \`splitUnits\` longtext DEFAULT NULL,
        \`materialComposition\` longtext DEFAULT NULL,
        \`storageConditions\` longtext DEFAULT NULL,
        \`storageOverrides\` longtext DEFAULT NULL,
        \`metadata\` longtext DEFAULT NULL,
        \`categoryId\` varchar(255) NOT NULL,
        \`supplierId\` varchar(255) DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`IDX_be69d815381efd53bb4dea8fd8\` (\`code\`),
        KEY \`FK_55aa2083ff218497bf0eae1704b\` (\`categoryId\`),
        KEY \`FK_d5ae7baa1aa3ab9bf5ed72b7faa\` (\`supplierId\`),
        CONSTRAINT \`FK_55aa2083ff218497bf0eae1704b\` FOREIGN KEY (\`categoryId\`) REFERENCES \`inventory_categories\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT \`FK_d5ae7baa1aa3ab9bf5ed72b7faa\` FOREIGN KEY (\`supplierId\`) REFERENCES \`suppliers\` (\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 5. batches
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`batches\` (
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`deletedAt\` datetime(6) DEFAULT NULL,
        \`deletedBy\` varchar(255) DEFAULT NULL,
        \`isDeleted\` tinyint(4) NOT NULL DEFAULT 0,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        \`id\` varchar(36) NOT NULL,
        \`batchNumber\` varchar(255) NOT NULL,
        \`itemType\` enum('medication','consumable') NOT NULL,
        \`manufactureDate\` date NOT NULL,
        \`expiryDate\` date NOT NULL,
        \`initialQuantity\` decimal(14,4) NOT NULL,
        \`availableQuantity\` decimal(14,4) NOT NULL,
        \`totalPacks\` decimal(10,0) NOT NULL DEFAULT 0,
        \`openedPacks\` decimal(10,0) NOT NULL DEFAULT 0,
        \`packSize\` decimal(10,4) DEFAULT NULL,
        \`quantityUnit\` varchar(20) DEFAULT NULL,
        \`isFractionalTracking\` tinyint(4) NOT NULL DEFAULT 0,
        \`unitCost\` decimal(10,2) NOT NULL,
        \`sellingPrice\` decimal(10,2) DEFAULT NULL,
        \`location\` varchar(255) DEFAULT NULL,
        \`notes\` text DEFAULT NULL,
        \`isPartial\` tinyint(4) NOT NULL DEFAULT 0,
        \`parentBatchId\` varchar(50) DEFAULT NULL,
        \`partialQuantity\` decimal(10,4) DEFAULT NULL,
        \`isSterile\` tinyint(4) NOT NULL DEFAULT 0,
        \`sterilityIndicator\` varchar(100) DEFAULT NULL,
        \`sterilityExpiryDate\` date DEFAULT NULL,
        \`isQualityTested\` tinyint(4) NOT NULL DEFAULT 1,
        \`qualityTestDate\` date DEFAULT NULL,
        \`qualityTestResult\` varchar(50) DEFAULT NULL,
        \`qualityTestNotes\` text DEFAULT NULL,
        \`isQuarantined\` tinyint(4) NOT NULL DEFAULT 0,
        \`reservedQuantity\` decimal(10,4) NOT NULL DEFAULT 0.0000,
        \`quarantineReason\` text DEFAULT NULL,
        \`quarantineDate\` date DEFAULT NULL,
        \`quarantineReleasedBy\` varchar(50) DEFAULT NULL,
        \`quarantineReleaseDate\` date DEFAULT NULL,
        \`certificateOfAnalysis\` varchar(100) DEFAULT NULL,
        \`manufacturingLicense\` varchar(100) DEFAULT NULL,
        \`importPermitNumber\` varchar(100) DEFAULT NULL,
        \`receivedDate\` date DEFAULT NULL,
        \`metadata\` longtext DEFAULT NULL,
        \`medicationItemId\` varchar(255) DEFAULT NULL,
        \`consumableItemId\` varchar(255) DEFAULT NULL,
        \`supplierId\` varchar(255) DEFAULT NULL,
        \`createdBy\` varchar(255) DEFAULT NULL,
        \`updatedBy\` varchar(255) DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`IDX_54653a69252ad13977e8e834fc\` (\`batchNumber\`),
        KEY \`IDX_26e2115eea7ee752de3f67c50e\` (\`isSterile\`),
        KEY \`IDX_4e968c925a50c7957135ff041c\` (\`parentBatchId\`),
        KEY \`IDX_97183ea393846a49c51054683c\` (\`supplierId\`),
        KEY \`IDX_a8b7d09e3c5cad48cf3cf0e8c5\` (\`consumableItemId\`),
        KEY \`IDX_577df9e472aec80ff4edd70d93\` (\`medicationItemId\`),
        KEY \`IDX_b56783b8ea1b6267dacc542283\` (\`isPartial\`),
        KEY \`IDX_f59436d6c6a2ab5ef8ec558509\` (\`isActive\`),
        KEY \`IDX_7e13642afe09034beafb293a02\` (\`manufactureDate\`),
        KEY \`IDX_df0bc8564a3668236b9ae7832e\` (\`expiryDate\`),
        KEY \`IDX_7d68b471b1e62265bb8357176d\` (\`itemType\`),
        CONSTRAINT \`FK_577df9e472aec80ff4edd70d936\` FOREIGN KEY (\`medicationItemId\`) REFERENCES \`medication_items\` (\`id\`) ON UPDATE NO ACTION,
        CONSTRAINT \`FK_97183ea393846a49c51054683ce\` FOREIGN KEY (\`supplierId\`) REFERENCES \`suppliers\` (\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT \`FK_a8b7d09e3c5cad48cf3cf0e8c5f\` FOREIGN KEY (\`consumableItemId\`) REFERENCES \`consumable_items\` (\`id\`) ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 6. medication_movements
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`medication_movements\` (
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`deletedAt\` datetime(6) DEFAULT NULL,
        \`deletedBy\` varchar(255) DEFAULT NULL,
        \`isDeleted\` tinyint(4) NOT NULL DEFAULT 0,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        \`id\` varchar(36) NOT NULL,
        \`type\` enum('RECEIPT','RETURN','ADJUSTMENT_IN','TRANSFER_IN','DONATION_IN','MANUFACTURE','DISPENSE','PARTIAL_DISPENSE','ADJUSTMENT_OUT','TRANSFER_OUT','DAMAGED','LOSS','EXPIRED','THEFT','DONATION_OUT','INTERNAL_USE','RESERVATION','RESERVATION_RELEASE','COST_ADJUSTMENT','PHYSICAL_COUNT','ADJUSTMENT','ADJUSTMENT_CORRECTION','UNRESERVATION','SERVICE','EMERGENCY_DISPENSE') NOT NULL,
        \`department\` varchar(255) NOT NULL,
        \`medicationItemId\` varchar(255) NOT NULL,
        \`batchId\` varchar(255) DEFAULT NULL,
        \`quantity\` decimal(10,4) NOT NULL,
        \`movementType\` enum('RECEIPT','RETURN','ADJUSTMENT_IN','TRANSFER_IN','DONATION_IN','MANUFACTURE','DISPENSE','PARTIAL_DISPENSE','ADJUSTMENT_OUT','TRANSFER_OUT','DAMAGED','LOSS','EXPIRED','THEFT','DONATION_OUT','INTERNAL_USE','RESERVATION','RESERVATION_RELEASE','COST_ADJUSTMENT','PHYSICAL_COUNT','ADJUSTMENT','ADJUSTMENT_CORRECTION','UNRESERVATION','SERVICE','EMERGENCY_DISPENSE') NOT NULL,
        \`reference\` text DEFAULT NULL,
        \`initiatedBy\` varchar(255) DEFAULT NULL,
        \`metadata\` longtext DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`FK_25f7e04729c7045f68ae0957073\` (\`medicationItemId\`),
        KEY \`FK_2968c0ba5adff81c532841af5f7\` (\`batchId\`),
        CONSTRAINT \`FK_25f7e04729c7045f68ae0957073\` FOREIGN KEY (\`medicationItemId\`) REFERENCES \`medication_items\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT \`FK_2968c0ba5adff81c532841af5f7\` FOREIGN KEY (\`batchId\`) REFERENCES \`batches\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 7. medication_adjustments
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`medication_adjustments\` (
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`deletedAt\` datetime(6) DEFAULT NULL,
        \`deletedBy\` varchar(255) DEFAULT NULL,
        \`isDeleted\` tinyint(4) NOT NULL DEFAULT 0,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        \`id\` varchar(36) NOT NULL,
        \`medicationItemId\` varchar(255) NOT NULL,
        \`batchId\` varchar(255) DEFAULT NULL,
        \`quantity\` decimal(10,4) NOT NULL,
        \`adjustmentType\` enum('ADD','REMOVE','CORRECTION','LOSS','DAMAGE','EXPIRY','THEFT','DONATION','RETURN','INTERNAL_USE') NOT NULL,
        \`reason\` text NOT NULL,
        \`initiatedBy\` varchar(255) NOT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`FK_ec0b90af33d26de63d435507d21\` (\`medicationItemId\`),
        KEY \`FK_354e601f77b9670859f0b7fa2c3\` (\`batchId\`),
        CONSTRAINT \`FK_ec0b90af33d26de63d435507d21\` FOREIGN KEY (\`medicationItemId\`) REFERENCES \`medication_items\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT \`FK_354e601f77b9670859f0b7fa2c3\` FOREIGN KEY (\`batchId\`) REFERENCES \`batches\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 8. medication_sales (without cross-domain FKs)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`medication_sales\` (
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`deletedAt\` datetime(6) DEFAULT NULL,
        \`deletedBy\` varchar(255) DEFAULT NULL,
        \`isDeleted\` tinyint(4) NOT NULL DEFAULT 0,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        \`id\` varchar(36) NOT NULL,
        \`medicationItemId\` varchar(255) NOT NULL,
        \`batchId\` varchar(255) DEFAULT NULL,
        \`quantity\` decimal(10,4) NOT NULL,
        \`unitPrice\` decimal(10,2) NOT NULL,
        \`totalPrice\` decimal(10,2) NOT NULL,
        \`patientId\` varchar(255) NOT NULL,
        \`appointmentId\` varchar(255) NOT NULL,
        \`department\` varchar(255) NOT NULL,
        \`recordedBy\` varchar(255) NOT NULL,
        \`notes\` text DEFAULT NULL,
        \`isControlledSubstance\` tinyint(4) NOT NULL DEFAULT 0,
        PRIMARY KEY (\`id\`),
        KEY \`FK_9bf89aba0350dd7273373a6870e\` (\`medicationItemId\`),
        KEY \`FK_58c45365cb8c5ff2cff7727e162\` (\`batchId\`),
        KEY \`FK_81fd9d9d768892c998aaf4e88d4\` (\`patientId\`),
        KEY \`FK_c50532dec2eb29b5a8aecd4ae78\` (\`appointmentId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 9. medication_partial_sales (without cross-domain FKs)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`medication_partial_sales\` (
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`deletedAt\` datetime(6) DEFAULT NULL,
        \`deletedBy\` varchar(255) DEFAULT NULL,
        \`isDeleted\` tinyint(4) NOT NULL DEFAULT 0,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        \`id\` varchar(36) NOT NULL,
        \`medicationItemId\` varchar(255) NOT NULL,
        \`batchId\` varchar(255) NOT NULL,
        \`originalPackSize\` decimal(14,4) NOT NULL,
        \`soldQuantity\` decimal(14,4) NOT NULL,
        \`quantityInBaseUnits\` decimal(14,4) DEFAULT NULL,
        \`remainingQuantity\` decimal(14,4) NOT NULL,
        \`remainingInPack\` decimal(14,4) DEFAULT NULL,
        \`unitOfMeasure\` varchar(20) NOT NULL,
        \`baseUnit\` varchar(20) DEFAULT NULL,
        \`packIdentifier\` varchar(100) DEFAULT NULL,
        \`packWasOpened\` tinyint(4) NOT NULL DEFAULT 0,
        \`packWasDepleted\` tinyint(4) NOT NULL DEFAULT 0,
        \`batchAvailableBeforeDispense\` decimal(14,4) DEFAULT NULL,
        \`batchAvailableAfterDispense\` decimal(14,4) DEFAULT NULL,
        \`batchSealedPacksAfter\` decimal(10,0) DEFAULT NULL,
        \`patientId\` varchar(255) NOT NULL,
        \`appointmentId\` varchar(255) NOT NULL,
        \`department\` varchar(255) NOT NULL,
        \`unitPrice\` decimal(10,4) DEFAULT NULL,
        \`totalPrice\` decimal(10,2) DEFAULT NULL,
        \`unitCost\` decimal(10,4) DEFAULT NULL,
        \`profitMargin\` decimal(10,2) DEFAULT NULL,
        \`requiresNewBatch\` tinyint(4) NOT NULL DEFAULT 0,
        \`isApproved\` tinyint(4) NOT NULL DEFAULT 0,
        \`approvedBy\` varchar(255) DEFAULT NULL,
        \`approvedAt\` timestamp NULL DEFAULT NULL,
        \`prescriptionReference\` varchar(50) DEFAULT NULL,
        \`isControlledSubstance\` tinyint(4) NOT NULL DEFAULT 0,
        \`pharmacistNotes\` text DEFAULT NULL,
        \`recordedBy\` varchar(255) NOT NULL,
        \`metadata\` longtext DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_4f43c543163fb89ada38cc36c2\` (\`medicationItemId\`),
        KEY \`IDX_ebcea09389792743c1d4c00398\` (\`batchId\`),
        KEY \`IDX_ee7802d4b89e9b0b24ccf7e8cc\` (\`packIdentifier\`),
        KEY \`IDX_79e8732fc238bc358fa69fb946\` (\`patientId\`),
        KEY \`IDX_75e4bb8c15ce3e230cbbba8fb2\` (\`appointmentId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 10. consumable_movements
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`consumable_movements\` (
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`deletedAt\` datetime(6) DEFAULT NULL,
        \`deletedBy\` varchar(255) DEFAULT NULL,
        \`isDeleted\` tinyint(4) NOT NULL DEFAULT 0,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        \`id\` varchar(36) NOT NULL,
        \`consumableItemId\` varchar(255) NOT NULL,
        \`type\` enum('RECEIPT','RETURN','ADJUSTMENT_IN','TRANSFER_IN','DONATION_IN','MANUFACTURE','DISPENSE','PARTIAL_DISPENSE','ADJUSTMENT_OUT','TRANSFER_OUT','DAMAGED','LOSS','EXPIRED','THEFT','DONATION_OUT','INTERNAL_USE','RESERVATION','RESERVATION_RELEASE','COST_ADJUSTMENT','PHYSICAL_COUNT','ADJUSTMENT','ADJUSTMENT_CORRECTION','UNRESERVATION','SERVICE','EMERGENCY_DISPENSE') NOT NULL,
        \`department\` varchar(255) NOT NULL,
        \`batchId\` varchar(255) DEFAULT NULL,
        \`quantity\` decimal(10,4) NOT NULL,
        \`movementType\` enum('RECEIPT','RETURN','ADJUSTMENT_IN','TRANSFER_IN','DONATION_IN','MANUFACTURE','DISPENSE','PARTIAL_DISPENSE','ADJUSTMENT_OUT','TRANSFER_OUT','DAMAGED','LOSS','EXPIRED','THEFT','DONATION_OUT','INTERNAL_USE','RESERVATION','RESERVATION_RELEASE','COST_ADJUSTMENT','PHYSICAL_COUNT','ADJUSTMENT','ADJUSTMENT_CORRECTION','UNRESERVATION','SERVICE','EMERGENCY_DISPENSE') NOT NULL,
        \`reference\` text DEFAULT NULL,
        \`initiatedBy\` varchar(255) DEFAULT NULL,
        \`metadata\` longtext DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`FK_ee334e14eeb1e9109f18f1fa148\` (\`consumableItemId\`),
        KEY \`FK_a01ca759550b278705a616a0bcf\` (\`batchId\`),
        CONSTRAINT \`FK_ee334e14eeb1e9109f18f1fa148\` FOREIGN KEY (\`consumableItemId\`) REFERENCES \`consumable_items\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT \`FK_a01ca759550b278705a616a0bcf\` FOREIGN KEY (\`batchId\`) REFERENCES \`batches\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 11. consumable_adjustments
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`consumable_adjustments\` (
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`deletedAt\` datetime(6) DEFAULT NULL,
        \`deletedBy\` varchar(255) DEFAULT NULL,
        \`isDeleted\` tinyint(4) NOT NULL DEFAULT 0,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        \`id\` varchar(36) NOT NULL,
        \`consumableItemId\` varchar(255) NOT NULL,
        \`batchId\` varchar(255) DEFAULT NULL,
        \`quantity\` decimal(10,4) NOT NULL,
        \`adjustmentType\` enum('ADD','REMOVE','CORRECTION','LOSS','DAMAGE','EXPIRY','THEFT','DONATION','RETURN','INTERNAL_USE') NOT NULL,
        \`reason\` text NOT NULL,
        \`initiatedBy\` varchar(255) NOT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`FK_bc5adceaff4360bd13c73a53bcc\` (\`consumableItemId\`),
        KEY \`FK_2f225b7e6e01afcc508eb9f8cb5\` (\`batchId\`),
        CONSTRAINT \`FK_bc5adceaff4360bd13c73a53bcc\` FOREIGN KEY (\`consumableItemId\`) REFERENCES \`consumable_items\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT \`FK_2f225b7e6e01afcc508eb9f8cb5\` FOREIGN KEY (\`batchId\`) REFERENCES \`batches\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 12. consumable_usages (without cross-domain FKs)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`consumable_usages\` (
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`deletedAt\` datetime(6) DEFAULT NULL,
        \`deletedBy\` varchar(255) DEFAULT NULL,
        \`isDeleted\` tinyint(4) NOT NULL DEFAULT 0,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        \`id\` varchar(36) NOT NULL,
        \`consumableItemId\` varchar(255) NOT NULL,
        \`batchId\` varchar(255) DEFAULT NULL,
        \`quantity\` decimal(10,4) NOT NULL,
        \`unitCost\` decimal(10,2) NOT NULL,
        \`department\` varchar(255) NOT NULL,
        \`patientId\` varchar(255) NOT NULL,
        \`appointmentId\` varchar(255) NOT NULL,
        \`notes\` text DEFAULT NULL,
        \`recordedBy\` varchar(255) NOT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`FK_2669fb06015d2a04b35b9e15076\` (\`consumableItemId\`),
        KEY \`FK_671a0078df701e4a09f46f72bbd\` (\`batchId\`),
        KEY \`FK_bb602ca8b6eb857b9e43a009139\` (\`patientId\`),
        KEY \`FK_751fb3603b238a7d1f259d9420b\` (\`appointmentId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 13. consumable_partial_usages (without cross-domain FKs)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`consumable_partial_usages\` (
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`deletedAt\` datetime(6) DEFAULT NULL,
        \`deletedBy\` varchar(255) DEFAULT NULL,
        \`isDeleted\` tinyint(4) NOT NULL DEFAULT 0,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        \`id\` varchar(36) NOT NULL,
        \`consumableItemId\` varchar(255) NOT NULL,
        \`batchId\` varchar(255) NOT NULL,
        \`originalPackSize\` decimal(14,4) NOT NULL,
        \`usedQuantity\` decimal(14,4) NOT NULL,
        \`quantityInBaseUnits\` decimal(14,4) DEFAULT NULL,
        \`remainingQuantity\` decimal(14,4) NOT NULL,
        \`remainingInPack\` decimal(14,4) DEFAULT NULL,
        \`unitOfMeasure\` varchar(20) NOT NULL,
        \`baseUnit\` varchar(20) DEFAULT NULL,
        \`packIdentifier\` varchar(100) DEFAULT NULL,
        \`packWasOpened\` tinyint(4) NOT NULL DEFAULT 0,
        \`packWasDepleted\` tinyint(4) NOT NULL DEFAULT 0,
        \`batchAvailableBeforeUsage\` decimal(14,4) DEFAULT NULL,
        \`batchAvailableAfterUsage\` decimal(14,4) DEFAULT NULL,
        \`batchSealedPacksAfter\` decimal(10,0) DEFAULT NULL,
        \`patientId\` varchar(255) NOT NULL,
        \`appointmentId\` varchar(255) NOT NULL,
        \`department\` varchar(255) NOT NULL,
        \`notes\` text DEFAULT NULL,
        \`unitPrice\` decimal(10,4) DEFAULT NULL,
        \`totalPrice\` decimal(10,2) DEFAULT NULL,
        \`unitCost\` decimal(10,4) DEFAULT NULL,
        \`profitMargin\` decimal(10,2) DEFAULT NULL,
        \`recordedBy\` varchar(255) NOT NULL,
        \`approvedBy\` varchar(255) DEFAULT NULL,
        \`approvedAt\` timestamp NULL DEFAULT NULL,
        \`requiresNewBatch\` tinyint(4) NOT NULL DEFAULT 0,
        \`metadata\` longtext DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_f67ef478290fab08e236293dcf\` (\`consumableItemId\`),
        KEY \`IDX_2925b48d0d861851c37d20fc79\` (\`batchId\`),
        KEY \`IDX_4541c2c384ee331629eba18f75\` (\`packIdentifier\`),
        KEY \`IDX_4f582d37315ea5815fee95f159\` (\`patientId\`),
        KEY \`IDX_f04a780ff611770c1fe8d9e690\` (\`appointmentId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 14. inventory_audits
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`inventory_audits\` (
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`deletedAt\` datetime(6) DEFAULT NULL,
        \`deletedBy\` varchar(255) DEFAULT NULL,
        \`isDeleted\` tinyint(4) NOT NULL DEFAULT 0,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        \`id\` varchar(36) NOT NULL,
        \`itemId\` varchar(255) NOT NULL,
        \`itemName\` varchar(255) NOT NULL,
        \`itemCode\` varchar(100) NOT NULL,
        \`itemType\` enum('medication','consumable') NOT NULL,
        \`previousQuantity\` decimal(10,4) NOT NULL,
        \`newQuantity\` decimal(10,4) NOT NULL,
        \`reason\` text DEFAULT NULL,
        \`performedBy\` varchar(100) NOT NULL,
        \`actionType\` enum('MANUAL_ADJUSTMENT','AUTOMATED_UPDATE','SYSTEM_SYNC','TRANSFER','OTHER') NOT NULL DEFAULT 'OTHER',
        \`auditDate\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        PRIMARY KEY (\`id\`),
        KEY \`IDX_cd6e69fc6f6a68530000f38e4f\` (\`itemId\`),
        KEY \`IDX_ec24e3afecd1f1fa4495da4df6\` (\`auditDate\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // ========================================================
    // Cross-domain foreign keys for medication_sales
    // ========================================================
    await queryRunner.query(`
      ALTER TABLE \`medication_sales\` ADD CONSTRAINT \`FK_9bf89aba0350dd7273373a6870e\` FOREIGN KEY (\`medicationItemId\`) REFERENCES \`medication_items\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE \`medication_sales\` ADD CONSTRAINT \`FK_58c45365cb8c5ff2cff7727e162\` FOREIGN KEY (\`batchId\`) REFERENCES \`batches\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE \`medication_sales\` ADD CONSTRAINT \`FK_81fd9d9d768892c998aaf4e88d4\` FOREIGN KEY (\`patientId\`) REFERENCES \`patients\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE \`medication_sales\` ADD CONSTRAINT \`FK_c50532dec2eb29b5a8aecd4ae78\` FOREIGN KEY (\`appointmentId\`) REFERENCES \`appointments\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    // ========================================================
    // Cross-domain foreign keys for medication_partial_sales
    // ========================================================
    await queryRunner.query(`
      ALTER TABLE \`medication_partial_sales\` ADD CONSTRAINT \`FK_4f43c543163fb89ada38cc36c20\` FOREIGN KEY (\`medicationItemId\`) REFERENCES \`medication_items\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE \`medication_partial_sales\` ADD CONSTRAINT \`FK_ebcea09389792743c1d4c003986\` FOREIGN KEY (\`batchId\`) REFERENCES \`batches\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE \`medication_partial_sales\` ADD CONSTRAINT \`FK_79e8732fc238bc358fa69fb946a\` FOREIGN KEY (\`patientId\`) REFERENCES \`patients\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE \`medication_partial_sales\` ADD CONSTRAINT \`FK_75e4bb8c15ce3e230cbbba8fb24\` FOREIGN KEY (\`appointmentId\`) REFERENCES \`appointments\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    // ========================================================
    // Cross-domain foreign keys for consumable_usages
    // ========================================================
    await queryRunner.query(`
      ALTER TABLE \`consumable_usages\` ADD CONSTRAINT \`FK_2669fb06015d2a04b35b9e15076\` FOREIGN KEY (\`consumableItemId\`) REFERENCES \`consumable_items\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE \`consumable_usages\` ADD CONSTRAINT \`FK_671a0078df701e4a09f46f72bbd\` FOREIGN KEY (\`batchId\`) REFERENCES \`batches\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE \`consumable_usages\` ADD CONSTRAINT \`FK_751fb3603b238a7d1f259d9420b\` FOREIGN KEY (\`appointmentId\`) REFERENCES \`appointments\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE \`consumable_usages\` ADD CONSTRAINT \`FK_bb602ca8b6eb857b9e43a009139\` FOREIGN KEY (\`patientId\`) REFERENCES \`patients\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    // ========================================================
    // Cross-domain foreign keys for consumable_partial_usages
    // ========================================================
    await queryRunner.query(`
      ALTER TABLE \`consumable_partial_usages\` ADD CONSTRAINT \`FK_2925b48d0d861851c37d20fc795\` FOREIGN KEY (\`batchId\`) REFERENCES \`batches\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE \`consumable_partial_usages\` ADD CONSTRAINT \`FK_4f582d37315ea5815fee95f1594\` FOREIGN KEY (\`patientId\`) REFERENCES \`patients\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE \`consumable_partial_usages\` ADD CONSTRAINT \`FK_f04a780ff611770c1fe8d9e6905\` FOREIGN KEY (\`appointmentId\`) REFERENCES \`appointments\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE \`consumable_partial_usages\` ADD CONSTRAINT \`FK_f67ef478290fab08e236293dcf2\` FOREIGN KEY (\`consumableItemId\`) REFERENCES \`consumable_items\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ========================================================
    // Drop cross-domain FKs for consumable_partial_usages
    // ========================================================
    await queryRunner.query(`ALTER TABLE \`consumable_partial_usages\` DROP FOREIGN KEY \`FK_f67ef478290fab08e236293dcf2\``);
    await queryRunner.query(`ALTER TABLE \`consumable_partial_usages\` DROP FOREIGN KEY \`FK_f04a780ff611770c1fe8d9e6905\``);
    await queryRunner.query(`ALTER TABLE \`consumable_partial_usages\` DROP FOREIGN KEY \`FK_4f582d37315ea5815fee95f1594\``);
    await queryRunner.query(`ALTER TABLE \`consumable_partial_usages\` DROP FOREIGN KEY \`FK_2925b48d0d861851c37d20fc795\``);

    // ========================================================
    // Drop cross-domain FKs for consumable_usages
    // ========================================================
    await queryRunner.query(`ALTER TABLE \`consumable_usages\` DROP FOREIGN KEY \`FK_bb602ca8b6eb857b9e43a009139\``);
    await queryRunner.query(`ALTER TABLE \`consumable_usages\` DROP FOREIGN KEY \`FK_751fb3603b238a7d1f259d9420b\``);
    await queryRunner.query(`ALTER TABLE \`consumable_usages\` DROP FOREIGN KEY \`FK_671a0078df701e4a09f46f72bbd\``);
    await queryRunner.query(`ALTER TABLE \`consumable_usages\` DROP FOREIGN KEY \`FK_2669fb06015d2a04b35b9e15076\``);

    // ========================================================
    // Drop cross-domain FKs for medication_partial_sales
    // ========================================================
    await queryRunner.query(`ALTER TABLE \`medication_partial_sales\` DROP FOREIGN KEY \`FK_75e4bb8c15ce3e230cbbba8fb24\``);
    await queryRunner.query(`ALTER TABLE \`medication_partial_sales\` DROP FOREIGN KEY \`FK_79e8732fc238bc358fa69fb946a\``);
    await queryRunner.query(`ALTER TABLE \`medication_partial_sales\` DROP FOREIGN KEY \`FK_ebcea09389792743c1d4c003986\``);
    await queryRunner.query(`ALTER TABLE \`medication_partial_sales\` DROP FOREIGN KEY \`FK_4f43c543163fb89ada38cc36c20\``);

    // ========================================================
    // Drop cross-domain FKs for medication_sales
    // ========================================================
    await queryRunner.query(`ALTER TABLE \`medication_sales\` DROP FOREIGN KEY \`FK_c50532dec2eb29b5a8aecd4ae78\``);
    await queryRunner.query(`ALTER TABLE \`medication_sales\` DROP FOREIGN KEY \`FK_81fd9d9d768892c998aaf4e88d4\``);
    await queryRunner.query(`ALTER TABLE \`medication_sales\` DROP FOREIGN KEY \`FK_58c45365cb8c5ff2cff7727e162\``);
    await queryRunner.query(`ALTER TABLE \`medication_sales\` DROP FOREIGN KEY \`FK_9bf89aba0350dd7273373a6870e\``);

    // ========================================================
    // Drop tables in reverse order
    // ========================================================
    await queryRunner.query(`DROP TABLE IF EXISTS \`inventory_audits\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`consumable_partial_usages\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`consumable_usages\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`consumable_adjustments\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`consumable_movements\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`medication_partial_sales\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`medication_sales\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`medication_adjustments\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`medication_movements\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`batches\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`consumable_items\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`medication_items\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`inventory_categories\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`suppliers\``);
  }
}
