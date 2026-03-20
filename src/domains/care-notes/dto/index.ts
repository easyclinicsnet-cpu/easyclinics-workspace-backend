// Common DTOs
export * from './common';

// Prescription DTOs
export * from './prescription';

// Repeat Prescription DTOs
export * from './repeat-prescription';

// Care Note DTOs
export * from './create-care-note.dto';
export * from './update-care-note.dto';
export * from './care-note-response.dto';
export * from './care-note-query.dto';
export * from './share-care-note.dto';

// Note Permission DTOs
export * from './create-note-permission.dto';
export * from './update-note-permission.dto';
export * from './note-permission-response.dto';
export * from './note-permission-query.dto';

// Note Template DTOs
export * from './create-note-template.dto';
export * from './update-note-template.dto';
export * from './note-template-response.dto';
export * from './note-template-query.dto';

// Note Version DTOs
export * from './note-version-response.dto';
export * from './note-version-query.dto';
export * from './restore-version.dto';

// Note Timeline DTOs
export * from './note-timeline-response.dto';
export * from './note-timeline-query.dto';

// AI Note DTOs
export * from './transcribe-audio.dto';
export * from './analyze-image.dto';
export * from './generate-note-from-transcript.dto';
export * from './approve-ai-note.dto';
export * from './reject-ai-note.dto';
export * from './regenerate-ai-note.dto';
export * from './ai-note-source-response.dto';
export * from './recordings-transcript-response.dto';
export * from './update-transcript-with-document.dto';

// Referral Letter DTOs
export * from './create-referral-letter.dto';
export * from './generate-referral-letter.dto';
export * from './update-referral-letter.dto';
export * from './referral-letter-response.dto';
export * from './referral-letter-query.dto';

// Sick Note DTOs
export * from './create-sick-note.dto';
export * from './generate-sick-note.dto';
export * from './update-sick-note.dto';
export * from './extend-sick-note.dto';
export * from './cancel-sick-note.dto';
export * from './sick-note-response.dto';
export * from './sick-note-query.dto';

// Audit DTOs
export * from './note-audit-log-response.dto';
export * from './note-audit-log-query.dto';

// Paginated Response (with constructor)
export * from './paginated-response.dto';
