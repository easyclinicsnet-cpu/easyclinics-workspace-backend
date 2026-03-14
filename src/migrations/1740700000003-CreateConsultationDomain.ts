import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateConsultationDomain1740700000003
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create consultations table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`consultations\` (
        \`id\` varchar(36) NOT NULL,
        \`patientId\` varchar(255) NOT NULL,
        \`appointmentId\` varchar(255) NOT NULL,
        \`doctorId\` varchar(255) NOT NULL,
        \`status\` enum('DRAFT','IN_PROGRESS','COMPLETED','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
        \`is_active\` tinyint(4) NOT NULL DEFAULT 1,
        \`is_open_for_joining\` tinyint(4) NOT NULL DEFAULT 0 COMMENT 'When true, allows other practitioners to request joining this consultation',
        \`requires_join_approval\` tinyint(4) NOT NULL DEFAULT 1 COMMENT 'When true, join requests require manual approval',
        \`createdAt\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`updatedAt\` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
        \`deletedAt\` timestamp NULL DEFAULT NULL,
        \`deleted_by\` varchar(255) DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`IDX_4753a48b855ace2da7af9fa1e0\` (\`appointmentId\`),
        UNIQUE KEY \`REL_4753a48b855ace2da7af9fa1e0\` (\`appointmentId\`),
        KEY \`IDX_9dc2a125f0cf9cacd9f908ba2a\` (\`doctorId\`),
        KEY \`IDX_e75c735da4edfcec042902c751\` (\`status\`),
        KEY \`IDX_1664d628f3929beff78acdd70e\` (\`is_open_for_joining\`),
        KEY \`IDX_187794bbcf77ed20f1a8c11fb6\` (\`requires_join_approval\`),
        KEY \`FK_a00f58f9b1e75d30d66ee4097d6\` (\`patientId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 2. Create consultation_collaborators table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`consultation_collaborators\` (
        \`id\` varchar(36) NOT NULL,
        \`consultationId\` varchar(255) NOT NULL,
        \`userId\` varchar(255) NOT NULL,
        \`role\` enum('workspace_owner','note_owner','system_admin','doctor','nurse','medical_assistant','pharmacist','therapist','practice_admin','billing_staff','scheduler','patient','read_only','lab_technician','radiology_technician','vendor') NOT NULL DEFAULT 'doctor',
        \`createdAt\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`updatedAt\` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
        \`deletedAt\` timestamp(6) NULL DEFAULT NULL,
        \`deletedById\` varchar(255) DEFAULT NULL,
        \`lastAccessedAt\` timestamp NULL DEFAULT NULL,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        PRIMARY KEY (\`id\`),
        KEY \`FK_e824428a16bf46430ff764553f9\` (\`consultationId\`),
        CONSTRAINT \`FK_e824428a16bf46430ff764553f9\` FOREIGN KEY (\`consultationId\`) REFERENCES \`consultations\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 3. Create consultation_join_requests table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`consultation_join_requests\` (
        \`id\` varchar(36) NOT NULL,
        \`consultationId\` varchar(255) NOT NULL,
        \`requestingUserId\` varchar(255) NOT NULL,
        \`role\` enum('workspace_owner','note_owner','system_admin','doctor','nurse','medical_assistant','pharmacist','therapist','practice_admin','billing_staff','scheduler','patient','read_only','lab_technician','radiology_technician','vendor') NOT NULL DEFAULT 'read_only',
        \`status\` enum('PENDING','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
        \`processedBy\` varchar(255) DEFAULT NULL,
        \`createdAt\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`updatedAt\` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
        \`processedAt\` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
        PRIMARY KEY (\`id\`),
        KEY \`FK_067eb9875593c0cab6425b9f0c6\` (\`consultationId\`),
        CONSTRAINT \`FK_067eb9875593c0cab6425b9f0c6\` FOREIGN KEY (\`consultationId\`) REFERENCES \`consultations\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 4. Add cross-domain foreign keys on consultations

    // consultations -> appointments
    await queryRunner.query(`
      ALTER TABLE \`consultations\`
        ADD CONSTRAINT \`FK_4753a48b855ace2da7af9fa1e0c\`
        FOREIGN KEY (\`appointmentId\`) REFERENCES \`appointments\` (\`id\`)
        ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    // consultations -> patients
    await queryRunner.query(`
      ALTER TABLE \`consultations\`
        ADD CONSTRAINT \`FK_a00f58f9b1e75d30d66ee4097d6\`
        FOREIGN KEY (\`patientId\`) REFERENCES \`patients\` (\`id\`)
        ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop cross-domain foreign keys on consultations
    await queryRunner.query(`
      ALTER TABLE \`consultations\` DROP FOREIGN KEY IF EXISTS \`FK_a00f58f9b1e75d30d66ee4097d6\`
    `);

    await queryRunner.query(`
      ALTER TABLE \`consultations\` DROP FOREIGN KEY IF EXISTS \`FK_4753a48b855ace2da7af9fa1e0c\`
    `);

    // 2. Drop tables in reverse order
    await queryRunner.query(`DROP TABLE IF EXISTS \`consultation_join_requests\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`consultation_collaborators\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`consultations\``);
  }
}
