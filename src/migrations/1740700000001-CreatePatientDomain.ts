import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePatientDomain1740700000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. patients
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`patients\` (
        \`id\` varchar(36) NOT NULL,
        \`externalId\` varchar(255) DEFAULT NULL,
        \`firstName\` varchar(255) NOT NULL COMMENT 'Encrypted field',
        \`lastName\` varchar(255) NOT NULL COMMENT 'Encrypted field',
        \`gender\` varchar(255) NOT NULL COMMENT 'Encrypted field',
        \`birthDate\` varchar(255) NOT NULL COMMENT 'Encrypted field',
        \`phoneNumber\` varchar(255) DEFAULT NULL COMMENT 'Encrypted field',
        \`medicalAid\` varchar(255) DEFAULT NULL COMMENT 'Encrypted field',
        \`membershipNumber\` varchar(255) DEFAULT NULL COMMENT 'Encrypted field',
        \`fileNumber\` varchar(255) DEFAULT NULL,
        \`email\` varchar(255) DEFAULT NULL COMMENT 'Encrypted field',
        \`city\` varchar(255) DEFAULT NULL COMMENT 'Encrypted field',
        \`address\` varchar(255) DEFAULT NULL COMMENT 'Encrypted field',
        \`nationalId\` varchar(255) DEFAULT NULL COMMENT 'Encrypted field',
        \`createdAt\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`updatedAt\` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
        \`deletedAt\` timestamp(6) NULL DEFAULT NULL,
        \`deletedById\` varchar(255) DEFAULT NULL,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        \`age\` varchar(255) DEFAULT NULL,
        \`insuranceMigrated\` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Tracks if patient insurance data has been migrated',
        \`insuranceMigratedAt\` timestamp NULL DEFAULT NULL COMMENT 'Timestamp when patient insurance was migrated',
        PRIMARY KEY (\`id\`),
        KEY \`idx_patients_file_number\` (\`fileNumber\`),
        KEY \`idx_patients_external_id\` (\`externalId\`),
        KEY \`idx_patients_is_active\` (\`isActive\`),
        KEY \`idx_patients_active_created\` (\`isActive\`, \`createdAt\` DESC),
        KEY \`idx_patients_active_updated\` (\`isActive\`, \`updatedAt\` DESC),
        KEY \`idx_patients_deleted_at\` (\`deletedAt\`),
        KEY \`idx_patients_insurance_migrated\` (\`insuranceMigrated\`, \`isActive\`),
        KEY \`idx_patients_insurance_migrated_at\` (\`insuranceMigratedAt\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);

    // 2. allergies
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`allergies\` (
        \`id\` varchar(36) NOT NULL,
        \`substance\` varchar(255) NOT NULL COMMENT 'Encrypted field',
        \`reaction\` varchar(255) NOT NULL COMMENT 'Encrypted field',
        \`severity\` enum('Mild','Moderate','Severe','Life-threatening') NOT NULL,
        \`userId\` varchar(255) NOT NULL COMMENT 'Encrypted field',
        \`createdAt\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`patientId\` varchar(36) DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`FK_7d607553f4d1eaf80098ec1bfe5\` (\`patientId\`),
        CONSTRAINT \`FK_7d607553f4d1eaf80098ec1bfe5\` FOREIGN KEY (\`patientId\`) REFERENCES \`patients\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);

    // 3. current-medications (hyphenated table name)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`current-medications\` (
        \`id\` varchar(36) NOT NULL,
        \`medicine\` varchar(255) NOT NULL COMMENT 'Encrypted field',
        \`dose\` varchar(255) DEFAULT NULL COMMENT 'Encrypted field',
        \`route\` varchar(255) DEFAULT NULL COMMENT 'Encrypted field',
        \`frequency\` varchar(255) DEFAULT NULL COMMENT 'Encrypted field',
        \`days\` varchar(255) DEFAULT NULL COMMENT 'Encrypted field',
        \`userId\` varchar(255) NOT NULL COMMENT 'Encrypted field',
        \`createdAt\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`patientId\` varchar(36) DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`FK_bdcf3b2c6df4ceebf380822fe99\` (\`patientId\`),
        CONSTRAINT \`FK_bdcf3b2c6df4ceebf380822fe99\` FOREIGN KEY (\`patientId\`) REFERENCES \`patients\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);

    // 4. family_conditions
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`family_conditions\` (
        \`id\` varchar(36) NOT NULL,
        \`relation\` varchar(255) NOT NULL COMMENT 'Encrypted field',
        \`condition\` varchar(255) NOT NULL COMMENT 'Encrypted field',
        \`notes\` text DEFAULT NULL COMMENT 'Encrypted field',
        \`userId\` varchar(255) NOT NULL COMMENT 'Encrypted field',
        \`createdAt\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`patientId\` varchar(36) DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`FK_e86148c8c59441b3d2b62636628\` (\`patientId\`),
        CONSTRAINT \`FK_e86148c8c59441b3d2b62636628\` FOREIGN KEY (\`patientId\`) REFERENCES \`patients\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);

    // 5. past_medical_history
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`past_medical_history\` (
        \`id\` varchar(36) NOT NULL,
        \`condition\` varchar(255) NOT NULL COMMENT 'Encrypted field',
        \`details\` varchar(255) DEFAULT NULL COMMENT 'Encrypted field',
        \`userId\` varchar(255) NOT NULL COMMENT 'Encrypted field',
        \`createdAt\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`patientId\` varchar(36) DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`FK_fd4bbec3c03c5f139c87339190b\` (\`patientId\`),
        CONSTRAINT \`FK_fd4bbec3c03c5f139c87339190b\` FOREIGN KEY (\`patientId\`) REFERENCES \`patients\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);

    // 6. past_surgical_history
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`past_surgical_history\` (
        \`id\` varchar(36) NOT NULL,
        \`procedure\` varchar(255) NOT NULL COMMENT 'Encrypted field',
        \`details\` varchar(255) DEFAULT NULL COMMENT 'Encrypted field',
        \`date\` date DEFAULT NULL,
        \`userId\` varchar(255) NOT NULL COMMENT 'Encrypted field',
        \`createdAt\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`patientId\` varchar(36) DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`FK_e7a1eba32eb46b6954b479ef0b0\` (\`patientId\`),
        CONSTRAINT \`FK_e7a1eba32eb46b6954b479ef0b0\` FOREIGN KEY (\`patientId\`) REFERENCES \`patients\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);

    // 7. social_history
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`social_history\` (
        \`id\` varchar(36) NOT NULL,
        \`smokingStatus\` enum('Never','Current','Former') NOT NULL DEFAULT 'Never',
        \`alcoholUse\` enum('Never','Occasionally','Regularly','Former') NOT NULL DEFAULT 'Never',
        \`drugUse\` enum('Never','Current','Former') NOT NULL DEFAULT 'Never',
        \`occupation\` text DEFAULT NULL COMMENT 'Encrypted field',
        \`additionalNotes\` text DEFAULT NULL COMMENT 'Encrypted field',
        \`userId\` varchar(255) NOT NULL COMMENT 'Encrypted field',
        \`createdAt\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`patientId\` varchar(36) DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`FK_9ce0848eb9a0a4c133e7c017209\` (\`patientId\`),
        CONSTRAINT \`FK_9ce0848eb9a0a4c133e7c017209\` FOREIGN KEY (\`patientId\`) REFERENCES \`patients\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables in reverse order (child tables first to respect FK constraints)
    await queryRunner.query(
      `DROP TABLE IF EXISTS \`social_history\``,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS \`past_surgical_history\``,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS \`past_medical_history\``,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS \`family_conditions\``,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS \`current-medications\``,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS \`allergies\``,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS \`patients\``,
    );
  }
}
