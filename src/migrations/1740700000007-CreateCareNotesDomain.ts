import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCareNotesDomain1740700000007
  implements MigrationInterface
{
  name = 'CreateCareNotesDomain1740700000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. recordings_transcript (standalone - no FKs)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`recordings_transcript\` (
        \`id\` varchar(36) NOT NULL,
        \`doctorId\` varchar(255) NOT NULL,
        \`consultationId\` varchar(255) NOT NULL,
        \`transcribedText\` text NOT NULL,
        \`audioFilePath\` varchar(255) NOT NULL,
        \`structuredTranscript\` text NOT NULL,
        \`aiProvider\` enum('openai','anthropic','gemini','azure_ai','custom') NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`modelUsed\` varchar(255) NOT NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 2. transcript_versions (FK to recordings_transcript)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`transcript_versions\` (
        \`id\` varchar(36) NOT NULL,
        \`transcriptId\` varchar(255) NOT NULL,
        \`transcribedText\` text NOT NULL,
        \`structuredTranscript\` text NOT NULL,
        \`versionNumber\` int(11) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`createdBy\` varchar(255) NOT NULL,
        \`changeMetadata\` longtext DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`FK_fd01b1e8c866d5eeaf3627f1471\` (\`transcriptId\`),
        CONSTRAINT \`FK_fd01b1e8c866d5eeaf3627f1471\` FOREIGN KEY (\`transcriptId\`) REFERENCES \`recordings_transcript\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 3. care_notes (cross-domain FKs to consultations and recordings_transcript)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`care_notes\` (
        \`id\` varchar(36) NOT NULL,
        \`consultationId\` varchar(255) NOT NULL,
        \`authorId\` varchar(255) NOT NULL,
        \`type\` enum('admission','consultation','procedure','operation','progress','discharge','emergency','follow_up','orthopedic_operation','general_examination') NOT NULL DEFAULT 'general_examination',
        \`status\` enum('draft','published','pending_approval','rejected','archived') NOT NULL DEFAULT 'draft',
        \`content\` text DEFAULT NULL,
        \`isAiGenerated\` tinyint(4) NOT NULL DEFAULT 0,
        \`version\` int(11) NOT NULL DEFAULT 1,
        \`isLatestVersion\` tinyint(4) NOT NULL DEFAULT 0,
        \`previousVersionId\` varchar(255) DEFAULT NULL,
        \`prescriptionId\` varchar(255) DEFAULT NULL,
        \`createdAt\` timestamp(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` timestamp(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`deletedAt\` timestamp(6) NULL DEFAULT NULL,
        \`deleted_by\` varchar(255) DEFAULT NULL,
        \`recordingsTranscriptId\` varchar(255) DEFAULT NULL,
        \`aiMetadata\` longtext DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_ee4864fcf5052d0bf62667f8f3\` (\`authorId\`),
        KEY \`IDX_147b3b5817caf42dfefaaa85c4\` (\`type\`),
        KEY \`IDX_acff15921055bbae5bd120cbd0\` (\`status\`),
        KEY \`FK_1bed516ffc429833939b54e3ba5\` (\`consultationId\`),
        KEY \`FK_831090e280d4df89641de0f5a41\` (\`recordingsTranscriptId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // Cross-domain FKs for care_notes
    await queryRunner.query(`
      ALTER TABLE \`care_notes\` ADD CONSTRAINT \`FK_1bed516ffc429833939b54e3ba5\` FOREIGN KEY (\`consultationId\`) REFERENCES \`consultations\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE \`care_notes\` ADD CONSTRAINT \`FK_831090e280d4df89641de0f5a41\` FOREIGN KEY (\`recordingsTranscriptId\`) REFERENCES \`recordings_transcript\` (\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    // 4. care_note_permissions (FK to care_notes)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`care_note_permissions\` (
        \`id\` varchar(36) NOT NULL,
        \`noteId\` varchar(255) NOT NULL,
        \`userId\` varchar(255) NOT NULL,
        \`canEdit\` tinyint(4) NOT NULL DEFAULT 0,
        \`canShare\` tinyint(4) NOT NULL DEFAULT 0,
        \`canDelete\` tinyint(4) NOT NULL DEFAULT 0,
        \`validFrom\` timestamp NULL DEFAULT NULL,
        \`validUntil\` timestamp NULL DEFAULT NULL,
        \`reason\` varchar(255) DEFAULT NULL,
        \`createdAt\` timestamp(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` timestamp(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        PRIMARY KEY (\`id\`),
        KEY \`IDX_a223b37a57c2de2ed863b08d6b\` (\`noteId\`),
        KEY \`IDX_b29ee98bf5e11a552704f85a10\` (\`userId\`),
        CONSTRAINT \`FK_a223b37a57c2de2ed863b08d6b9\` FOREIGN KEY (\`noteId\`) REFERENCES \`care_notes\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 5. care_note_templates (standalone)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`care_note_templates\` (
        \`id\` varchar(36) NOT NULL,
        \`name\` varchar(255) NOT NULL,
        \`description\` text NOT NULL,
        \`noteType\` enum('admission','consultation','procedure','operation','progress','discharge','emergency','follow_up','orthopedic_operation','general_examination') NOT NULL,
        \`type\` enum('system','specialty','user','department') NOT NULL DEFAULT 'system',
        \`template\` longtext DEFAULT NULL,
        \`ownerId\` varchar(255) DEFAULT NULL,
        \`specialtyId\` varchar(255) DEFAULT NULL,
        \`departmentId\` varchar(255) DEFAULT NULL,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        \`createdAt\` timestamp(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` timestamp(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`deletedAt\` timestamp(6) NULL DEFAULT NULL,
        \`deleted_by\` varchar(255) DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_0d7b6ea41f775d69de4c87b9b0\` (\`noteType\`),
        KEY \`IDX_2948ccfadc28c5eb40469233a3\` (\`type\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 6. care_note_timelines (cross-domain FKs to consultations, care_notes)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`care_note_timelines\` (
        \`id\` varchar(36) NOT NULL,
        \`consultationId\` varchar(255) NOT NULL,
        \`noteId\` varchar(255) NOT NULL,
        \`sequence\` int(11) NOT NULL,
        \`eventType\` varchar(255) DEFAULT NULL,
        \`createdAt\` timestamp(6) NOT NULL DEFAULT current_timestamp(6),
        \`eventTimestamp\` timestamp NULL DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_2f59c3e2265420f4a0629c6b8f\` (\`sequence\`),
        KEY \`FK_9831f06dd46d7355536f2a3910b\` (\`consultationId\`),
        KEY \`FK_711fc115a8b8574097bbbc04efd\` (\`noteId\`),
        CONSTRAINT \`FK_711fc115a8b8574097bbbc04efd\` FOREIGN KEY (\`noteId\`) REFERENCES \`care_notes\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT \`FK_9831f06dd46d7355536f2a3910b\` FOREIGN KEY (\`consultationId\`) REFERENCES \`consultations\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 7. care_ai_note_sources (FK to care_notes)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`care_ai_note_sources\` (
        \`id\` varchar(36) NOT NULL,
        \`noteId\` varchar(255) DEFAULT NULL,
        \`consultationId\` varchar(255) NOT NULL,
        \`provider\` enum('openai','anthropic','gemini','azure_ai','custom') NOT NULL,
        \`model\` varchar(255) NOT NULL,
        \`sourceContent\` text NOT NULL,
        \`parentSourceId\` varchar(255) DEFAULT NULL,
        \`createdBy\` varchar(255) NOT NULL,
        \`createdAt\` timestamp(6) NOT NULL DEFAULT current_timestamp(6),
        \`metadata\` longtext DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_c71aefd1fd22f202cc3a6f5054\` (\`noteId\`),
        KEY \`IDX_2c0099ead9fb60a2c22104a3ae\` (\`consultationId\`),
        CONSTRAINT \`FK_c71aefd1fd22f202cc3a6f50548\` FOREIGN KEY (\`noteId\`) REFERENCES \`care_notes\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 8. note_versions (FK to care_notes with CASCADE)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`note_versions\` (
        \`id\` varchar(36) NOT NULL,
        \`noteId\` varchar(255) NOT NULL,
        \`versionNumber\` int(11) NOT NULL,
        \`content\` text DEFAULT NULL,
        \`status\` enum('draft','published','pending_approval','rejected','archived') NOT NULL,
        \`authorId\` varchar(255) NOT NULL,
        \`isAiGenerated\` tinyint(4) NOT NULL DEFAULT 0,
        \`createdAt\` timestamp(6) NOT NULL DEFAULT current_timestamp(6),
        \`aiMetadata\` longtext DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_174f878d9f2d92aeeb574db43a\` (\`noteId\`),
        KEY \`IDX_3af6c8df065cc7204bbb4d01e4\` (\`versionNumber\`),
        KEY \`IDX_c5eeec8a5e1cd8a2f0ea834402\` (\`createdAt\`),
        CONSTRAINT \`FK_174f878d9f2d92aeeb574db43ab\` FOREIGN KEY (\`noteId\`) REFERENCES \`care_notes\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 9. note_audit_logs (indexes only, no FK constraints)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`note_audit_logs\` (
        \`id\` varchar(36) NOT NULL,
        \`noteId\` varchar(255) NOT NULL,
        \`userId\` varchar(255) NOT NULL,
        \`actionType\` enum('create','update','delete','publish','approve','share','permission_change','ai_generate','ai_approve','ai_reject','version_restore','modify','revert') NOT NULL,
        \`ipAddress\` text DEFAULT NULL,
        \`userAgent\` text DEFAULT NULL,
        \`created_at\` timestamp(6) NOT NULL DEFAULT current_timestamp(6),
        \`updated_at\` timestamp(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`metadata\` longtext DEFAULT NULL,
        \`changedFields\` longtext DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_6c977e4e1baeff4dc0bab99c21\` (\`noteId\`),
        KEY \`IDX_edc0af21b382f91fc7aace38f4\` (\`userId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 10. prescriptions (cross-domain FKs to appointments, consultations, care_notes)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`prescriptions\` (
        \`id\` varchar(36) NOT NULL,
        \`medicine\` varchar(255) NOT NULL COMMENT 'Encrypted field',
        \`dose\` varchar(255) DEFAULT NULL COMMENT 'Encrypted field',
        \`route\` varchar(255) DEFAULT NULL COMMENT 'Encrypted field',
        \`frequency\` varchar(255) DEFAULT NULL COMMENT 'Encrypted field',
        \`days\` varchar(255) DEFAULT NULL COMMENT 'Encrypted field',
        \`appointmentId\` varchar(255) NOT NULL,
        \`consultationId\` varchar(255) NOT NULL,
        \`noteId\` varchar(255) DEFAULT NULL,
        \`doctorId\` varchar(255) NOT NULL,
        \`createdAt\` timestamp(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` timestamp(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`deletedAt\` timestamp(6) NULL DEFAULT NULL,
        \`deleted_by\` varchar(255) DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_5c22ff49adf67549a85db811a7\` (\`appointmentId\`),
        KEY \`IDX_29fe8d9d7fd15107817912ff60\` (\`consultationId\`),
        KEY \`IDX_42c70415fad4505386e6d7e9dc\` (\`doctorId\`),
        KEY \`FK_dc27e876eb95eb77b9b4e1cdb15\` (\`noteId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // Cross-domain FKs for prescriptions
    await queryRunner.query(`
      ALTER TABLE \`prescriptions\` ADD CONSTRAINT \`FK_29fe8d9d7fd15107817912ff604\` FOREIGN KEY (\`consultationId\`) REFERENCES \`consultations\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE \`prescriptions\` ADD CONSTRAINT \`FK_5c22ff49adf67549a85db811a72\` FOREIGN KEY (\`appointmentId\`) REFERENCES \`appointments\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE \`prescriptions\` ADD CONSTRAINT \`FK_dc27e876eb95eb77b9b4e1cdb15\` FOREIGN KEY (\`noteId\`) REFERENCES \`care_notes\` (\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    // 11. repeat_prescriptions (cross-domain FK to patients)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`repeat_prescriptions\` (
        \`id\` varchar(36) NOT NULL,
        \`patientId\` varchar(255) NOT NULL,
        \`medicine\` varchar(255) NOT NULL,
        \`dose\` varchar(255) NOT NULL,
        \`route\` varchar(255) NOT NULL,
        \`frequency\` varchar(255) NOT NULL,
        \`days\` varchar(255) NOT NULL,
        \`startDate\` datetime NOT NULL,
        \`endDate\` datetime DEFAULT NULL,
        \`instructions\` text DEFAULT NULL,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`deletedAt\` datetime(6) DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`FK_6fabf09565553b64ba3c1f7072f\` (\`patientId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // Cross-domain FK for repeat_prescriptions
    await queryRunner.query(`
      ALTER TABLE \`repeat_prescriptions\` ADD CONSTRAINT \`FK_6fabf09565553b64ba3c1f7072f\` FOREIGN KEY (\`patientId\`) REFERENCES \`patients\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    // 12. referral_letters (cross-domain FKs to patients, consultations)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`referral_letters\` (
        \`id\` varchar(36) NOT NULL,
        \`doctorId\` varchar(255) NOT NULL,
        \`patientId\` varchar(255) NOT NULL,
        \`consultationId\` varchar(255) NOT NULL,
        \`transcriptId\` varchar(255) DEFAULT NULL,
        \`clinicalSummary\` text DEFAULT NULL,
        \`examinationFindings\` text DEFAULT NULL,
        \`investigationResults\` text DEFAULT NULL,
        \`treatmentToDate\` text DEFAULT NULL,
        \`reasonForReferral\` text DEFAULT NULL,
        \`specificQuestions\` text DEFAULT NULL,
        \`referralType\` enum('specialist','diagnostic','therapy','surgical','other') NOT NULL,
        \`urgency\` enum('routine','urgent','emergency') NOT NULL DEFAULT 'routine',
        \`referredToService\` text NOT NULL,
        \`referredToClinician\` text DEFAULT NULL,
        \`referredToFacility\` text NOT NULL,
        \`facilityAddress\` text DEFAULT NULL,
        \`facilityContact\` text DEFAULT NULL,
        \`insuranceAuthorization\` text DEFAULT NULL,
        \`requiresAppointment\` tinyint(4) NOT NULL DEFAULT 0,
        \`preferredAppointmentDate\` timestamp NULL DEFAULT NULL,
        \`specialInstructions\` text DEFAULT NULL,
        \`finalLetterContent\` text NOT NULL,
        \`status\` enum('draft','issued','sent','acknowledged','completed','cancelled') NOT NULL DEFAULT 'draft',
        \`isIssued\` tinyint(4) NOT NULL DEFAULT 0,
        \`issuedAt\` timestamp NULL DEFAULT NULL,
        \`isSent\` tinyint(4) NOT NULL DEFAULT 0,
        \`sentAt\` timestamp NULL DEFAULT NULL,
        \`trackingNumber\` text DEFAULT NULL,
        \`acknowledgementReference\` text DEFAULT NULL,
        \`acknowledgedAt\` timestamp NULL DEFAULT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`deletedAt\` timestamp(6) NULL DEFAULT NULL,
        \`deletedById\` varchar(255) DEFAULT NULL,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_584b58edbe9773ce3aa874410a\` (\`doctorId\`,\`status\`),
        KEY \`IDX_f4462c12c996a58133c03a0144\` (\`consultationId\`),
        KEY \`IDX_fde2227ae5a49165d425f4ae82\` (\`patientId\`,\`createdAt\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // Cross-domain FKs for referral_letters
    await queryRunner.query(`
      ALTER TABLE \`referral_letters\` ADD CONSTRAINT \`FK_acdc3addfe03d45b7c5b3c6a7af\` FOREIGN KEY (\`patientId\`) REFERENCES \`patients\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE \`referral_letters\` ADD CONSTRAINT \`FK_f4462c12c996a58133c03a0144f\` FOREIGN KEY (\`consultationId\`) REFERENCES \`consultations\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    // 13. sick_notes (cross-domain FKs to patients, consultations)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sick_notes\` (
        \`id\` varchar(36) NOT NULL,
        \`doctorId\` varchar(255) NOT NULL,
        \`patientId\` varchar(255) NOT NULL,
        \`consultationId\` varchar(255) NOT NULL,
        \`transcriptId\` varchar(255) DEFAULT NULL,
        \`diagnosis\` text NOT NULL,
        \`icd10Code\` text DEFAULT NULL,
        \`clinicalSummary\` text NOT NULL,
        \`relevantFindings\` text DEFAULT NULL,
        \`startDate\` date NOT NULL,
        \`endDate\` date NOT NULL,
        \`durationDays\` int(11) NOT NULL,
        \`workRestriction\` enum('full_rest','light_duty','modified_duty','no_restriction','hospitalization') NOT NULL,
        \`specificRestrictions\` text DEFAULT NULL,
        \`accommodations\` text DEFAULT NULL,
        \`requiresFollowUp\` tinyint(4) NOT NULL DEFAULT 0,
        \`followUpDate\` date DEFAULT NULL,
        \`followUpInstructions\` text DEFAULT NULL,
        \`isHospitalized\` tinyint(4) NOT NULL DEFAULT 0,
        \`expectedReturnDate\` date DEFAULT NULL,
        \`finalNoteContent\` text NOT NULL,
        \`status\` enum('draft','issued','extended','expired','cancelled') NOT NULL DEFAULT 'draft',
        \`isIssued\` tinyint(4) NOT NULL DEFAULT 0,
        \`issuedAt\` timestamp NULL DEFAULT NULL,
        \`issuerSignature\` text DEFAULT NULL,
        \`issuerLicenseNumber\` text DEFAULT NULL,
        \`issuerName\` text DEFAULT NULL,
        \`practiceStamp\` text DEFAULT NULL,
        \`originalNoteId\` varchar(255) DEFAULT NULL,
        \`isExtension\` tinyint(4) NOT NULL DEFAULT 0,
        \`createdAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
        \`deletedAt\` timestamp(6) NULL DEFAULT NULL,
        \`deletedById\` varchar(255) DEFAULT NULL,
        \`isActive\` tinyint(4) NOT NULL DEFAULT 1,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_fbae6ba19b2465101227586734\` (\`endDate\`),
        KEY \`IDX_73f3eb91bd7671b3e694d7169a\` (\`doctorId\`,\`status\`),
        KEY \`IDX_aafe63596ba476921010ac22e9\` (\`consultationId\`),
        KEY \`IDX_942d9c95d2b70a0a4eaa13dcef\` (\`patientId\`,\`startDate\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // Cross-domain FKs for sick_notes
    await queryRunner.query(`
      ALTER TABLE \`sick_notes\` ADD CONSTRAINT \`FK_78eafa9b4c0961e28799391b399\` FOREIGN KEY (\`patientId\`) REFERENCES \`patients\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE \`sick_notes\` ADD CONSTRAINT \`FK_aafe63596ba476921010ac22e9e\` FOREIGN KEY (\`consultationId\`) REFERENCES \`consultations\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    // 14. background_transcriptions (cross-domain FK to consultations)
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

    // Cross-domain FK for background_transcriptions
    await queryRunner.query(`
      ALTER TABLE \`background_transcriptions\` ADD CONSTRAINT \`FK_0395727ecab0c4c5ddc38324b90\` FOREIGN KEY (\`consultationId\`) REFERENCES \`consultations\` (\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop all cross-domain FKs first

    // background_transcriptions cross-domain FKs
    await queryRunner.query(`
      ALTER TABLE \`background_transcriptions\` DROP FOREIGN KEY \`FK_0395727ecab0c4c5ddc38324b90\`
    `);

    // sick_notes cross-domain FKs
    await queryRunner.query(`
      ALTER TABLE \`sick_notes\` DROP FOREIGN KEY \`FK_aafe63596ba476921010ac22e9e\`
    `);

    await queryRunner.query(`
      ALTER TABLE \`sick_notes\` DROP FOREIGN KEY \`FK_78eafa9b4c0961e28799391b399\`
    `);

    // referral_letters cross-domain FKs
    await queryRunner.query(`
      ALTER TABLE \`referral_letters\` DROP FOREIGN KEY \`FK_f4462c12c996a58133c03a0144f\`
    `);

    await queryRunner.query(`
      ALTER TABLE \`referral_letters\` DROP FOREIGN KEY \`FK_acdc3addfe03d45b7c5b3c6a7af\`
    `);

    // repeat_prescriptions cross-domain FKs
    await queryRunner.query(`
      ALTER TABLE \`repeat_prescriptions\` DROP FOREIGN KEY \`FK_6fabf09565553b64ba3c1f7072f\`
    `);

    // prescriptions cross-domain FKs
    await queryRunner.query(`
      ALTER TABLE \`prescriptions\` DROP FOREIGN KEY \`FK_dc27e876eb95eb77b9b4e1cdb15\`
    `);

    await queryRunner.query(`
      ALTER TABLE \`prescriptions\` DROP FOREIGN KEY \`FK_5c22ff49adf67549a85db811a72\`
    `);

    await queryRunner.query(`
      ALTER TABLE \`prescriptions\` DROP FOREIGN KEY \`FK_29fe8d9d7fd15107817912ff604\`
    `);

    // care_notes cross-domain FKs
    await queryRunner.query(`
      ALTER TABLE \`care_notes\` DROP FOREIGN KEY \`FK_831090e280d4df89641de0f5a41\`
    `);

    await queryRunner.query(`
      ALTER TABLE \`care_notes\` DROP FOREIGN KEY \`FK_1bed516ffc429833939b54e3ba5\`
    `);

    // Drop tables in reverse order
    await queryRunner.query(`DROP TABLE IF EXISTS \`background_transcriptions\``);

    await queryRunner.query(`DROP TABLE IF EXISTS \`sick_notes\``);

    await queryRunner.query(`DROP TABLE IF EXISTS \`referral_letters\``);

    await queryRunner.query(`DROP TABLE IF EXISTS \`repeat_prescriptions\``);

    await queryRunner.query(`DROP TABLE IF EXISTS \`prescriptions\``);

    await queryRunner.query(`DROP TABLE IF EXISTS \`note_audit_logs\``);

    await queryRunner.query(`DROP TABLE IF EXISTS \`note_versions\``);

    await queryRunner.query(`DROP TABLE IF EXISTS \`care_ai_note_sources\``);

    await queryRunner.query(`DROP TABLE IF EXISTS \`care_note_timelines\``);

    await queryRunner.query(`DROP TABLE IF EXISTS \`care_note_templates\``);

    await queryRunner.query(`DROP TABLE IF EXISTS \`care_note_permissions\``);

    await queryRunner.query(`DROP TABLE IF EXISTS \`care_notes\``);

    await queryRunner.query(`DROP TABLE IF EXISTS \`transcript_versions\``);

    await queryRunner.query(`DROP TABLE IF EXISTS \`recordings_transcript\``);
  }
}
