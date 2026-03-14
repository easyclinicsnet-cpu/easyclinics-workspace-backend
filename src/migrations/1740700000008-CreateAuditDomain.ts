import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuditDomain1740700000008 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create audit_log table (standalone, no FKs)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`audit_log\` (
        \`id\` varchar(36) NOT NULL,
        \`userId\` varchar(255) NOT NULL,
        \`action\` varchar(255) NOT NULL,
        \`timestamp\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`metadata\` longtext DEFAULT NULL,
        \`outcome\` varchar(255) NOT NULL,
        \`patientId\` varchar(255) DEFAULT NULL,
        \`justification\` text DEFAULT NULL,
        \`eventType\` varchar(255) NOT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_2621409ebc295c5da7ff3e4139\` (\`userId\`),
        KEY \`IDX_0a448ead20d80566aea46a66de\` (\`eventType\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);

    // 2. Create audit_contexts table (standalone, no FKs)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`audit_contexts\` (
        \`id\` varchar(36) NOT NULL,
        \`action\` varchar(50) NOT NULL,
        \`adjustmentType\` enum('ADD','REMOVE','CORRECTION','LOSS','DAMAGE','EXPIRY','THEFT','DONATION','RETURN','INTERNAL_USE') DEFAULT NULL,
        \`movementType\` enum('RECEIPT','RETURN','ADJUSTMENT_IN','TRANSFER_IN','DONATION_IN','MANUFACTURE','DISPENSE','PARTIAL_DISPENSE','ADJUSTMENT_OUT','TRANSFER_OUT','DAMAGED','LOSS','EXPIRED','THEFT','DONATION_OUT','INTERNAL_USE','RESERVATION','RESERVATION_RELEASE','COST_ADJUSTMENT','PHYSICAL_COUNT','ADJUSTMENT','ADJUSTMENT_CORRECTION','UNRESERVATION','SERVICE','EMERGENCY_DISPENSE') DEFAULT NULL,
        \`itemId\` varchar(255) NOT NULL,
        \`itemName\` varchar(255) NOT NULL,
        \`quantity\` decimal(10,4) DEFAULT NULL,
        \`batchId\` varchar(255) DEFAULT NULL,
        \`batchNumber\` varchar(100) DEFAULT NULL,
        \`userId\` varchar(255) NOT NULL,
        \`userRole\` varchar(100) NOT NULL,
        \`reason\` text DEFAULT NULL,
        \`status\` varchar(50) NOT NULL DEFAULT 'COMPLETED',
        \`ipAddress\` varchar(100) DEFAULT NULL,
        \`userAgent\` varchar(500) DEFAULT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`previousState\` longtext DEFAULT NULL,
        \`newState\` longtext DEFAULT NULL,
        \`metadata\` longtext DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_f89acc515203d41eb8be9b1aea\` (\`action\`,\`createdAt\`),
        KEY \`IDX_f25e2722607d9550accf60dee7\` (\`userId\`,\`createdAt\`),
        KEY \`IDX_3c76e4dbf5e04383237b7557ff\` (\`itemId\`,\`createdAt\`),
        KEY \`IDX_12f0c901df5a7e74c35f4e23c6\` (\`createdAt\`),
        KEY \`IDX_6b8b91a365cf53e5cbf5b23a76\` (\`batchId\`,\`createdAt\`),
        KEY \`idx_audit_context_createdAyt\` (\`createdAt\`),
        KEY \`idx_audit_context_itemId\` (\`itemId\`,\`createdAt\`),
        KEY \`idx_audit_context_batchId\` (\`batchId\`,\`createdAt\`),
        KEY \`idx_audit_context_userId\` (\`userId\`,\`createdAt\`),
        KEY \`idx_audit_context_action\` (\`action\`,\`createdAt\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables in reverse order
    await queryRunner.query(`DROP TABLE IF EXISTS \`audit_contexts\`;`);
    await queryRunner.query(`DROP TABLE IF EXISTS \`audit_log\`;`);
  }
}
