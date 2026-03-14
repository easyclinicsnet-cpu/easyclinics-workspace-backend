import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSchedulingDomain1740700000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create appointments table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`appointments\` (
        \`id\` varchar(36) NOT NULL,
        \`patientId\` varchar(255) NOT NULL,
        \`consultationId\` varchar(255) DEFAULT NULL,
        \`type\` enum('REVIEW','EMERGENCY','ROUTINE','INITIAL') NOT NULL DEFAULT 'INITIAL',
        \`date\` date NOT NULL,
        \`time\` varchar(255) NOT NULL,
        \`paymentMethod\` varchar(255) NOT NULL,
        \`status\` enum('SCHEDULED','COMPLETED','CANCELLED','MISSED','IN_PROGRESS') NOT NULL DEFAULT 'SCHEDULED',
        \`createdAt\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        \`transcriptionId\` varchar(255) NOT NULL,
        \`userId\` varchar(255) NOT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`FK_13c2e57cb81b44f062ba24df57d\` (\`patientId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 2. Create vitals table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`vitals\` (
        \`id\` varchar(36) NOT NULL,
        \`temperature\` varchar(255) NOT NULL COMMENT 'Encrypted field - Temperature in Celsius',
        \`bloodPressure\` varchar(255) NOT NULL COMMENT 'Encrypted field - Blood pressure (systolic/diastolic)',
        \`heartRate\` varchar(255) NOT NULL COMMENT 'Encrypted field - Heart rate in BPM',
        \`saturation\` varchar(255) NOT NULL COMMENT 'Encrypted field - Oxygen saturation percentage',
        \`gcs\` varchar(255) NOT NULL COMMENT 'Encrypted field - Glasgow Coma Scale score',
        \`bloodGlucose\` varchar(255) NOT NULL COMMENT 'Encrypted field - Blood glucose in mg/dL',
        \`height\` varchar(255) NOT NULL COMMENT 'Encrypted field - Height in centimeters',
        \`weight\` varchar(255) NOT NULL COMMENT 'Encrypted field - Weight in kilograms',
        \`time\` time NOT NULL DEFAULT current_timestamp(),
        \`appointmentId\` varchar(255) DEFAULT NULL,
        \`patientId\` varchar(255) DEFAULT NULL,
        \`consultationId\` varchar(255) DEFAULT NULL,
        \`userId\` varchar(255) NOT NULL,
        \`createdAt\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`updatedAt\` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
        \`deletedAt\` timestamp(6) NULL DEFAULT NULL,
        \`deletedById\` varchar(255) DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`FK_aec43d717881bb4f5cf3b0b7595\` (\`appointmentId\`),
        KEY \`FK_18d995ee0fc66f9ebded708850c\` (\`patientId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 3. Add foreign keys via ALTER TABLE

    // appointments -> patients
    await queryRunner.query(`
      ALTER TABLE \`appointments\`
        ADD CONSTRAINT \`FK_13c2e57cb81b44f062ba24df57d\`
        FOREIGN KEY (\`patientId\`) REFERENCES \`patients\` (\`id\`)
        ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    // vitals -> appointments
    await queryRunner.query(`
      ALTER TABLE \`vitals\`
        ADD CONSTRAINT \`FK_aec43d717881bb4f5cf3b0b7595\`
        FOREIGN KEY (\`appointmentId\`) REFERENCES \`appointments\` (\`id\`)
        ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    // vitals -> patients
    await queryRunner.query(`
      ALTER TABLE \`vitals\`
        ADD CONSTRAINT \`FK_18d995ee0fc66f9ebded708850c\`
        FOREIGN KEY (\`patientId\`) REFERENCES \`patients\` (\`id\`)
        ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop foreign keys first

    // vitals -> patients
    await queryRunner.query(`
      ALTER TABLE \`vitals\` DROP FOREIGN KEY IF EXISTS \`FK_18d995ee0fc66f9ebded708850c\`
    `);

    // vitals -> appointments
    await queryRunner.query(`
      ALTER TABLE \`vitals\` DROP FOREIGN KEY IF EXISTS \`FK_aec43d717881bb4f5cf3b0b7595\`
    `);

    // appointments -> patients
    await queryRunner.query(`
      ALTER TABLE \`appointments\` DROP FOREIGN KEY IF EXISTS \`FK_13c2e57cb81b44f062ba24df57d\`
    `);

    // 2. Drop tables in reverse order
    await queryRunner.query(`DROP TABLE IF EXISTS \`vitals\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`appointments\``);
  }
}
