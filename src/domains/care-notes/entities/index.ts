/**
 * Care Notes Domain Entities
 * Exports all entities for the care notes and medical documentation domain
 */

export { CareNote } from './care-note.entity';
export { Prescription } from './prescription.entity';
export { RecordingsTranscript } from './recordings-transcript.entity';
export { NoteVersion } from './note-version.entity';
// NoteAuditLog lives in the audit domain (src/domains/audit/entities/note-audit-log.entity.ts)
// Re-export for backward compatibility
export { NoteAuditLog } from '../../audit/entities/note-audit-log.entity';
export { CareNotePermission } from './care-note-permission.entity';
export { CareNoteTemplate } from './care-note-template.entity';
export { CareNoteTimeline } from './care-note-timeline.entity';
export { CareAiNoteSource } from './care-ai-note-source.entity';
export { SickNote } from './sick-note.entity';
export { ReferralLetter } from './referral-letter.entity';
export { RepeatPrescription } from './repeat-prescription.entity';
export { TranscriptionJob } from './transcription-job.entity';
