-- =============================================================================
-- Migration: CollaborationRole Enum Update
-- Date:       2026-03-13
-- Description:
--   Updates two EMR tables to align CollaborationRole with the portal backend's
--   WorkspaceMemberRole refactoring.
--
--   Tables affected:
--     1. consultation_collaborators.role
--     2. consultation_join_requests.role
--
--   Removed values (no longer valid workspace roles):
--     'NOTE_OWNER'   → mapped to 'DOCTOR'         (closest clinical equivalent)
--     'SYSTEM_ADMIN' → mapped to 'WORKSPACE_OWNER' (closest admin equivalent)
--
--   Added values:
--     'CO_OWNER', 'ADMIN', 'MANAGER', 'PHYSICIAN', 'STAFF', 'GUEST'
--
-- !! RUN THIS MIGRATION BEFORE STARTING THE APPLICATION !!
--    TypeORM synchronize: true will try to MODIFY the ENUM columns.
--    Running this first ensures the schema is already correct so TypeORM
--    generates no ALTER statements on startup.
--
-- Safe to re-run: data updates are idempotent.
-- Tested on: MySQL 8.0+ / MariaDB 10.5+
-- =============================================================================

START TRANSACTION;

-- ---------------------------------------------------------------------------
-- STEP 1 — consultation_collaborators.role
-- ---------------------------------------------------------------------------

-- 1a. Widen to VARCHAR (removes ENUM constraint during data fix)
ALTER TABLE `consultation_collaborators`
  MODIFY COLUMN `role` VARCHAR(50) NOT NULL DEFAULT 'DOCTOR';

-- 1b. Map removed values to valid equivalents
UPDATE `consultation_collaborators`
SET    `role` = 'WORKSPACE_OWNER'
WHERE  `role` = 'SYSTEM_ADMIN';

UPDATE `consultation_collaborators`
SET    `role` = 'DOCTOR'
WHERE  `role` = 'NOTE_OWNER';

-- 1c. Re-apply as the new CollaborationRole ENUM
ALTER TABLE `consultation_collaborators`
  MODIFY COLUMN `role`
    ENUM(
      'WORKSPACE_OWNER',
      'CO_OWNER',
      'ADMIN',
      'MANAGER',
      'PHYSICIAN',
      'DOCTOR',
      'NURSE',
      'MEDICAL_ASSISTANT',
      'PHARMACIST',
      'THERAPIST',
      'PRACTICE_ADMIN',
      'BILLING_STAFF',
      'SCHEDULER',
      'LAB_TECHNICIAN',
      'RADIOLOGY_TECHNICIAN',
      'STAFF',
      'READ_ONLY',
      'PATIENT',
      'VENDOR',
      'GUEST'
    )
    NOT NULL
    DEFAULT 'DOCTOR'
    COMMENT 'Collaboration role for this consultant (CollaborationRole). Aligned with WorkspaceMemberRole from portal.';


-- ---------------------------------------------------------------------------
-- STEP 2 — consultation_join_requests.role
-- ---------------------------------------------------------------------------

-- 2a. Widen to VARCHAR
ALTER TABLE `consultation_join_requests`
  MODIFY COLUMN `role` VARCHAR(50) NOT NULL DEFAULT 'READ_ONLY';

-- 2b. Map removed values to valid equivalents
UPDATE `consultation_join_requests`
SET    `role` = 'WORKSPACE_OWNER'
WHERE  `role` = 'SYSTEM_ADMIN';

UPDATE `consultation_join_requests`
SET    `role` = 'DOCTOR'
WHERE  `role` = 'NOTE_OWNER';

-- 2c. Re-apply as the new CollaborationRole ENUM
ALTER TABLE `consultation_join_requests`
  MODIFY COLUMN `role`
    ENUM(
      'WORKSPACE_OWNER',
      'CO_OWNER',
      'ADMIN',
      'MANAGER',
      'PHYSICIAN',
      'DOCTOR',
      'NURSE',
      'MEDICAL_ASSISTANT',
      'PHARMACIST',
      'THERAPIST',
      'PRACTICE_ADMIN',
      'BILLING_STAFF',
      'SCHEDULER',
      'LAB_TECHNICIAN',
      'RADIOLOGY_TECHNICIAN',
      'STAFF',
      'READ_ONLY',
      'PATIENT',
      'VENDOR',
      'GUEST'
    )
    NOT NULL
    DEFAULT 'READ_ONLY'
    COMMENT 'Requested collaboration role (CollaborationRole). Aligned with WorkspaceMemberRole from portal.';


-- ---------------------------------------------------------------------------
-- STEP 3 — Verification queries
-- ---------------------------------------------------------------------------

-- Both should return 0
SELECT COUNT(*) AS invalid_collaborator_roles
FROM   `consultation_collaborators`
WHERE  `role` NOT IN (
  'WORKSPACE_OWNER', 'CO_OWNER', 'ADMIN', 'MANAGER', 'PHYSICIAN',
  'DOCTOR', 'NURSE', 'MEDICAL_ASSISTANT', 'PHARMACIST', 'THERAPIST',
  'PRACTICE_ADMIN', 'BILLING_STAFF', 'SCHEDULER',
  'LAB_TECHNICIAN', 'RADIOLOGY_TECHNICIAN',
  'STAFF', 'READ_ONLY', 'PATIENT', 'VENDOR', 'GUEST'
);

SELECT COUNT(*) AS invalid_join_request_roles
FROM   `consultation_join_requests`
WHERE  `role` NOT IN (
  'WORKSPACE_OWNER', 'CO_OWNER', 'ADMIN', 'MANAGER', 'PHYSICIAN',
  'DOCTOR', 'NURSE', 'MEDICAL_ASSISTANT', 'PHARMACIST', 'THERAPIST',
  'PRACTICE_ADMIN', 'BILLING_STAFF', 'SCHEDULER',
  'LAB_TECHNICIAN', 'RADIOLOGY_TECHNICIAN',
  'STAFF', 'READ_ONLY', 'PATIENT', 'VENDOR', 'GUEST'
);

-- Distribution summary for review
SELECT `role`, COUNT(*) AS cnt FROM `consultation_collaborators`   GROUP BY `role` ORDER BY cnt DESC;
SELECT `role`, COUNT(*) AS cnt FROM `consultation_join_requests`   GROUP BY `role` ORDER BY cnt DESC;


COMMIT;


-- =============================================================================
-- ROLLBACK (restores old CollaborationRole ENUM — original data is NOT recoverable
--           for rows that had NOTE_OWNER / SYSTEM_ADMIN; restore from backup if needed)
-- =============================================================================
-- START TRANSACTION;
--
-- ALTER TABLE `consultation_collaborators`  MODIFY COLUMN `role` VARCHAR(50) NOT NULL DEFAULT 'DOCTOR';
-- ALTER TABLE `consultation_join_requests`  MODIFY COLUMN `role` VARCHAR(50) NOT NULL DEFAULT 'READ_ONLY';
--
-- ALTER TABLE `consultation_collaborators`
--   MODIFY COLUMN `role`
--     ENUM('WORKSPACE_OWNER','NOTE_OWNER','SYSTEM_ADMIN',
--          'DOCTOR','NURSE','MEDICAL_ASSISTANT','PHARMACIST','THERAPIST',
--          'PRACTICE_ADMIN','BILLING_STAFF','SCHEDULER','PATIENT','READ_ONLY',
--          'LAB_TECHNICIAN','RADIOLOGY_TECHNICIAN','VENDOR')
--     NOT NULL DEFAULT 'DOCTOR';
--
-- ALTER TABLE `consultation_join_requests`
--   MODIFY COLUMN `role`
--     ENUM('WORKSPACE_OWNER','NOTE_OWNER','SYSTEM_ADMIN',
--          'DOCTOR','NURSE','MEDICAL_ASSISTANT','PHARMACIST','THERAPIST',
--          'PRACTICE_ADMIN','BILLING_STAFF','SCHEDULER','PATIENT','READ_ONLY',
--          'LAB_TECHNICIAN','RADIOLOGY_TECHNICIAN','VENDOR')
--     NOT NULL DEFAULT 'READ_ONLY';
--
-- COMMIT;
