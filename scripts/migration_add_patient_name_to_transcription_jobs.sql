-- =============================================================================
-- Migration: Add patientName column to transcription_jobs
-- Corresponds to TypeORM migration: 1740700000010-AddPatientNameToTranscriptionJobs
-- =============================================================================

-- UP
ALTER TABLE `transcription_jobs`
  ADD COLUMN `patientName` VARCHAR(200) DEFAULT NULL
  AFTER `consultationId`;

-- =============================================================================
-- DOWN (rollback)
-- =============================================================================
-- ALTER TABLE `transcription_jobs`
--   DROP COLUMN `patientName`;
