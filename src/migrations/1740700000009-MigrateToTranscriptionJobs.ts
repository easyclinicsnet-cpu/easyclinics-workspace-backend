import { MigrationInterface, QueryRunner } from 'typeorm';

export class MigrateToTranscriptionJobs1740700000009
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Phase 1: Create `transcription_jobs` table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`transcription_jobs\` (
        \`id\` varchar(36) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`deletedAt\` datetime(6) DEFAULT NULL,
        \`deletedBy\` varchar(255) DEFAULT NULL,
        \`isDeleted\` tinyint(4) NOT NULL DEFAULT 0,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        \`workspaceId\` varchar(255) NOT NULL,
        \`doctorId\` varchar(255) NOT NULL,
        \`consultationId\` varchar(255) NOT NULL,
        \`mode\` varchar(20) NOT NULL DEFAULT 'STANDARD',
        \`status\` varchar(50) NOT NULL DEFAULT 'PENDING',
        \`currentStep\` varchar(50) NOT NULL DEFAULT 'UPLOAD',
        \`progressPercentage\` tinyint UNSIGNED NOT NULL DEFAULT 0,
        \`progressMessage\` varchar(500) DEFAULT NULL,
        \`audioFilePath\` varchar(255) NOT NULL,
        \`audioFileSizeBytes\` bigint UNSIGNED DEFAULT NULL,
        \`audioDurationSeconds\` int UNSIGNED DEFAULT NULL,
        \`provider\` varchar(50) DEFAULT NULL,
        \`model\` varchar(100) DEFAULT NULL,
        \`language\` varchar(10) DEFAULT 'en',
        \`temperature\` decimal(3,2) DEFAULT NULL,
        \`context\` text DEFAULT NULL,
        \`noteType\` varchar(50) DEFAULT NULL,
        \`templateId\` varchar(36) DEFAULT NULL,
        \`rawTranscribedText\` text DEFAULT NULL,
        \`transcriptPreview\` varchar(500) DEFAULT NULL,
        \`transcriptId\` varchar(255) DEFAULT NULL,
        \`noteId\` varchar(255) DEFAULT NULL,
        \`resolvedProvider\` varchar(50) DEFAULT NULL,
        \`resolvedModel\` varchar(100) DEFAULT NULL,
        \`processingTimeMs\` int UNSIGNED DEFAULT NULL,
        \`retryCount\` tinyint UNSIGNED NOT NULL DEFAULT 0,
        \`errorMessage\` varchar(1000) DEFAULT NULL,
        \`errorDetails\` text DEFAULT NULL,
        \`startedAt\` timestamp NULL DEFAULT NULL,
        \`completedAt\` timestamp NULL DEFAULT NULL,
        \`noteGeneratedAt\` timestamp NULL DEFAULT NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // Phase 2: Add indexes (matching the entity @Index decorators)
    await queryRunner.query(`
      ALTER TABLE \`transcription_jobs\`
        ADD KEY \`IDX_tj_workspace_status\` (\`workspaceId\`, \`status\`),
        ADD KEY \`IDX_tj_workspace_mode_status\` (\`workspaceId\`, \`mode\`, \`status\`),
        ADD KEY \`IDX_tj_consultation_status\` (\`consultationId\`, \`status\`),
        ADD KEY \`IDX_tj_doctor_status\` (\`doctorId\`, \`status\`),
        ADD KEY \`IDX_tj_doctor_mode\` (\`doctorId\`, \`mode\`),
        ADD KEY \`IDX_tj_createdAt\` (\`createdAt\`)
    `);

    // Phase 3: Migrate data from background_transcriptions
    await queryRunner.query(`
      INSERT INTO \`transcription_jobs\` (
        \`id\`,
        \`createdAt\`,
        \`updatedAt\`,
        \`deletedAt\`,
        \`deletedBy\`,
        \`isDeleted\`,
        \`isActive\`,
        \`workspaceId\`,
        \`doctorId\`,
        \`consultationId\`,
        \`mode\`,
        \`status\`,
        \`currentStep\`,
        \`progressPercentage\`,
        \`progressMessage\`,
        \`audioFilePath\`,
        \`audioFileSizeBytes\`,
        \`audioDurationSeconds\`,
        \`provider\`,
        \`model\`,
        \`language\`,
        \`temperature\`,
        \`context\`,
        \`noteType\`,
        \`templateId\`,
        \`rawTranscribedText\`,
        \`transcriptPreview\`,
        \`transcriptId\`,
        \`noteId\`,
        \`resolvedProvider\`,
        \`resolvedModel\`,
        \`processingTimeMs\`,
        \`retryCount\`,
        \`errorMessage\`,
        \`errorDetails\`,
        \`startedAt\`,
        \`completedAt\`,
        \`noteGeneratedAt\`
      )
      SELECT
        bt.\`id\`,
        bt.\`createdAt\`,
        bt.\`updatedAt\`,
        NULL,
        NULL,
        0,
        1,
        DATABASE(),
        bt.\`doctorId\`,
        bt.\`consultationId\`,
        'BACKGROUND',
        bt.\`status\`,
        bt.\`currentStep\`,
        CASE
          WHEN bt.\`status\` IN ('COMPLETED','NOTE_GENERATED','PENDING_NOTE_GENERATION') THEN 100
          WHEN bt.\`status\` = 'FAILED' THEN 0
          WHEN bt.\`status\` = 'CANCELLED' THEN 0
          WHEN bt.\`status\` = 'STRUCTURING' THEN 70
          WHEN bt.\`status\` = 'TRANSCRIBING' THEN 30
          WHEN bt.\`status\` = 'PROCESSING' THEN 10
          WHEN bt.\`status\` = 'NOTE_GENERATION' THEN 95
          ELSE 0
        END,
        CASE
          WHEN bt.\`status\` = 'COMPLETED' THEN 'Transcription complete'
          WHEN bt.\`status\` = 'NOTE_GENERATED' THEN 'Clinical note generated successfully'
          WHEN bt.\`status\` = 'PENDING_NOTE_GENERATION' THEN 'Transcription complete — ready for note generation'
          WHEN bt.\`status\` = 'FAILED' THEN 'Transcription failed'
          WHEN bt.\`status\` = 'CANCELLED' THEN 'Transcription cancelled by user'
          WHEN bt.\`status\` = 'STRUCTURING' THEN 'Generating structured transcript…'
          WHEN bt.\`status\` = 'TRANSCRIBING' THEN 'Transcribing audio…'
          WHEN bt.\`status\` = 'PROCESSING' THEN 'Processing audio file…'
          WHEN bt.\`status\` = 'NOTE_GENERATION' THEN 'Generating clinical note…'
          WHEN bt.\`status\` = 'PENDING' THEN 'Queued for processing'
          ELSE NULL
        END,
        bt.\`audioFilePath\`,
        NULL,
        NULL,
        JSON_UNQUOTE(JSON_EXTRACT(bt.\`metadata\`, '$.provider')),
        JSON_UNQUOTE(JSON_EXTRACT(bt.\`metadata\`, '$.model')),
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(bt.\`metadata\`, '$.language')), 'en'),
        JSON_EXTRACT(bt.\`metadata\`, '$.temperature'),
        JSON_UNQUOTE(JSON_EXTRACT(bt.\`metadata\`, '$.context')),
        JSON_UNQUOTE(JSON_EXTRACT(bt.\`metadata\`, '$.noteType')),
        JSON_UNQUOTE(JSON_EXTRACT(bt.\`metadata\`, '$.templateId')),
        JSON_UNQUOTE(JSON_EXTRACT(bt.\`metadata\`, '$.rawTranscribedText')),
        LEFT(JSON_UNQUOTE(JSON_EXTRACT(bt.\`metadata\`, '$.transcriptPreview')), 500),
        bt.\`transcriptId\`,
        bt.\`noteId\`,
        JSON_UNQUOTE(JSON_EXTRACT(bt.\`metadata\`, '$.resolvedProvider')),
        JSON_UNQUOTE(JSON_EXTRACT(bt.\`metadata\`, '$.resolvedModel')),
        JSON_EXTRACT(bt.\`metadata\`, '$.processingTimeMs'),
        bt.\`retryCount\`,
        JSON_UNQUOTE(JSON_EXTRACT(bt.\`metadata\`, '$.errorMessage')),
        JSON_UNQUOTE(JSON_EXTRACT(bt.\`metadata\`, '$.errorDetails')),
        bt.\`startedAt\`,
        bt.\`completedAt\`,
        bt.\`noteGeneratedAt\`
      FROM \`background_transcriptions\` bt
    `);

    // Phase 4: Verify data integrity
    const [result] = await queryRunner.query(`
      SELECT
        (SELECT COUNT(*) FROM \`background_transcriptions\`) AS source_count,
        (SELECT COUNT(*) FROM \`transcription_jobs\` WHERE \`mode\` = 'BACKGROUND') AS migrated_count
    `);

    if (result.source_count !== result.migrated_count) {
      throw new Error(
        `Data integrity check failed: background_transcriptions has ${result.source_count} rows ` +
          `but transcription_jobs has ${result.migrated_count} BACKGROUND rows`,
      );
    }

    // Phase 5: Drop FK on background_transcriptions, then drop the table
    await queryRunner.query(`
      ALTER TABLE \`background_transcriptions\` DROP FOREIGN KEY \`FK_0395727ecab0c4c5ddc38324b90\`
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS \`background_transcriptions\`
    `);

    // Phase 6: Add FK on transcription_jobs.consultationId -> consultations(id)
    await queryRunner.query(`
      ALTER TABLE \`transcription_jobs\` ADD CONSTRAINT \`FK_tj_consultationId\`
        FOREIGN KEY (\`consultationId\`) REFERENCES \`consultations\` (\`id\`)
        ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Step 1: Drop FK on transcription_jobs
    await queryRunner.query(`
      ALTER TABLE \`transcription_jobs\` DROP FOREIGN KEY IF EXISTS \`FK_tj_consultationId\`
    `);

    // Step 2: Recreate background_transcriptions table (exact legacy schema)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`background_transcriptions\` (
        \`id\` varchar(36) NOT NULL,
        \`status\` enum('PENDING','PROCESSING','TRANSCRIBING','PENDING_NOTE_GENERATION','NOTE_GENERATION','COMPLETED','FAILED','STRUCTURING','NOTE_GENERATED','CANCELLED') NOT NULL DEFAULT 'PENDING',
        \`currentStep\` enum('UPLOAD','AUDIO_PROCESSING','TRANSCRIPTION','NOTE_GENERATION','COMPLETED','ERROR','STRUCTURING','SAVING','PENDING_NOTE','NOTE_GENERATED') NOT NULL DEFAULT 'UPLOAD',
        \`doctorId\` varchar(255) NOT NULL,
        \`consultationId\` varchar(255) NOT NULL,
        \`transcriptId\` varchar(255) DEFAULT NULL,
        \`noteId\` varchar(255) DEFAULT NULL,
        \`audioFilePath\` varchar(255) NOT NULL,
        \`retryCount\` int(11) NOT NULL DEFAULT 0,
        \`completedAt\` datetime DEFAULT NULL,
        \`startedAt\` datetime DEFAULT NULL,
        \`noteGeneratedAt\` datetime DEFAULT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`metadata\` longtext DEFAULT NULL,
        \`progress\` longtext DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_4776baad939a977b38a4cee5fd\` (\`audioFilePath\`),
        KEY \`IDX_5045cbfdd91d31b17c3bb64d0e\` (\`createdAt\`),
        KEY \`IDX_428f6058b9c13e9d01e25ef8f1\` (\`doctorId\`,\`status\`),
        KEY \`IDX_94b8288c64eb9fcd1dbb6b6638\` (\`consultationId\`,\`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // Step 3: Migrate data back (only BACKGROUND mode rows)
    await queryRunner.query(`
      INSERT INTO \`background_transcriptions\` (
        \`id\`, \`status\`, \`currentStep\`, \`doctorId\`, \`consultationId\`,
        \`transcriptId\`, \`noteId\`, \`audioFilePath\`, \`retryCount\`,
        \`completedAt\`, \`startedAt\`, \`noteGeneratedAt\`, \`createdAt\`, \`updatedAt\`,
        \`metadata\`, \`progress\`
      )
      SELECT
        tj.\`id\`,
        tj.\`status\`,
        tj.\`currentStep\`,
        tj.\`doctorId\`,
        tj.\`consultationId\`,
        tj.\`transcriptId\`,
        tj.\`noteId\`,
        tj.\`audioFilePath\`,
        tj.\`retryCount\`,
        tj.\`completedAt\`,
        tj.\`startedAt\`,
        tj.\`noteGeneratedAt\`,
        tj.\`createdAt\`,
        tj.\`updatedAt\`,
        JSON_OBJECT(
          'provider', tj.\`provider\`,
          'model', tj.\`model\`,
          'language', tj.\`language\`,
          'noteType', tj.\`noteType\`,
          'resolvedProvider', tj.\`resolvedProvider\`,
          'resolvedModel', tj.\`resolvedModel\`,
          'processingTimeMs', tj.\`processingTimeMs\`,
          'errorMessage', tj.\`errorMessage\`
        ),
        JSON_OBJECT(
          'percentage', tj.\`progressPercentage\`,
          'message', tj.\`progressMessage\`
        )
      FROM \`transcription_jobs\` tj
      WHERE tj.\`mode\` = 'BACKGROUND'
    `);

    // Step 4: Add FK back on background_transcriptions
    await queryRunner.query(`
      ALTER TABLE \`background_transcriptions\` ADD CONSTRAINT \`FK_0395727ecab0c4c5ddc38324b90\`
        FOREIGN KEY (\`consultationId\`) REFERENCES \`consultations\` (\`id\`)
        ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    // Step 5: Drop transcription_jobs table
    await queryRunner.query(`
      DROP TABLE IF EXISTS \`transcription_jobs\`
    `);
  }
}
