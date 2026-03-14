/**
 * Common enums used across the application
 */

export enum Gender {
  MALE = 'Male',
  FEMALE = 'Female',
  OTHER = 'Other',
}

export enum AppointmentStatus {
  SCHEDULED = 'SCHEDULED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  MISSED = 'MISSED',
  IN_PROGRESS = 'IN_PROGRESS',
}

export enum AppointmentType {
  REVIEW = 'REVIEW',
  EMERGENCY = 'EMERGENCY',
  ROUTINE = 'ROUTINE',
  INITIAL = 'INITIAL',
}

export enum ConsultationStatus {
  DRAFT = 'DRAFT',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  ARCHIVED = 'ARCHIVED',
}

/**
 * Workspace-scoped member roles.
 * Values match WorkspaceMemberRole in the portal backend (workspace_memberships.role).
 * These are carried in the workspace JWT as the `workspaceMemberRole` claim.
 */
export enum UserRole {
  WORKSPACE_OWNER       = 'workspace_owner',
  CO_OWNER              = 'workspace_co_owner',
  ADMIN                 = 'admin',
  MANAGER               = 'manager',
  PHYSICIAN             = 'physician',
  DOCTOR                = 'doctor',
  NURSE                 = 'nurse',
  MEDICAL_ASSISTANT     = 'medical_assistant',
  PHARMACIST            = 'pharmacist',
  THERAPIST             = 'therapist',
  PRACTICE_ADMIN        = 'practice_admin',
  BILLING_STAFF         = 'billing_staff',
  SCHEDULER             = 'scheduler',
  LAB_TECHNICIAN        = 'lab_technician',
  RADIOLOGY_TECHNICIAN  = 'radiology_technician',
  STAFF                 = 'staff',
  READ_ONLY             = 'read_only',
  PATIENT               = 'patient',
  VENDOR                = 'vendor',
  GUEST                 = 'guest',
}

export enum Severity {
  MILD = 'Mild',
  MODERATE = 'Moderate',
  SEVERE = 'Severe',
  LIFE_THREATENING = 'Life-threatening',
}

export enum SmokingStatus {
  NEVER = 'Never',
  CURRENT = 'Current',
  FORMER = 'Former',
}

export enum AlcoholUse {
  NEVER = 'Never',
  OCCASIONALLY = 'Occasionally',
  REGULARLY = 'Regularly',
  FORMER = 'Former',
}

export enum DrugUse {
  NEVER = 'Never',
  CURRENT = 'Current',
  FORMER = 'Former',
}

export enum ItemType {
  MEDICATION = 'medication',
  CONSUMABLE = 'consumable',
}

export enum MovementType {
  RECEIPT = 'RECEIPT',
  RETURN = 'RETURN',
  ADJUSTMENT_IN = 'ADJUSTMENT_IN',
  TRANSFER_IN = 'TRANSFER_IN',
  DONATION_IN = 'DONATION_IN',
  MANUFACTURE = 'MANUFACTURE',
  DISPENSE = 'DISPENSE',
  PARTIAL_DISPENSE = 'PARTIAL_DISPENSE',
  ADJUSTMENT_OUT = 'ADJUSTMENT_OUT',
  TRANSFER_OUT = 'TRANSFER_OUT',
  DAMAGED = 'DAMAGED',
  LOSS = 'LOSS',
  EXPIRED = 'EXPIRED',
  THEFT = 'THEFT',
  DONATION_OUT = 'DONATION_OUT',
  INTERNAL_USE = 'INTERNAL_USE',
  RESERVATION = 'RESERVATION',
  RESERVATION_RELEASE = 'RESERVATION_RELEASE',
  COST_ADJUSTMENT = 'COST_ADJUSTMENT',
  PHYSICAL_COUNT = 'PHYSICAL_COUNT',
  ADJUSTMENT = 'ADJUSTMENT',
  ADJUSTMENT_CORRECTION = 'ADJUSTMENT_CORRECTION',
  UNRESERVATION = 'UNRESERVATION',
  SERVICE = 'SERVICE',
  EMERGENCY_DISPENSE = 'EMERGENCY_DISPENSE',
}

export enum AdjustmentType {
  ADD = 'ADD',
  REMOVE = 'REMOVE',
  CORRECTION = 'CORRECTION',
  LOSS = 'LOSS',
  DAMAGE = 'DAMAGE',
  EXPIRY = 'EXPIRY',
  THEFT = 'THEFT',
  DONATION = 'DONATION',
  RETURN = 'RETURN',
  INTERNAL_USE = 'INTERNAL_USE',
}

export enum BillStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
  VOIDED = 'VOIDED',
  PARTIAL = 'PARTIAL',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  PROCESSING = 'PROCESSING',
  CANCELLED = 'CANCELLED',
  DECLINED = 'DECLINED',
}

export enum PaymentMethodType {
  CASH = 'CASH',
  CREDIT_CARD = 'CREDIT_CARD',
  DEBIT_CARD = 'DEBIT_CARD',
  BANK_TRANSFER = 'BANK_TRANSFER',
  CHEQUE = 'CHEQUE',
  INSURANCE = 'INSURANCE',
  MOBILE_MONEY = 'MOBILE_MONEY',
  ONLINE = 'ONLINE',
  HMO = 'HMO',
  CORPORATE = 'CORPORATE',
  VOUCHER = 'VOUCHER',
  OTHER = 'OTHER',
}

export enum InsuranceClaimStatus {
  NOT_CLAIMED = 'NOT_CLAIMED',
  CLAIMED = 'CLAIMED',
  PENDING = 'PENDING',
  PARTIALLY_APPROVED = 'PARTIALLY_APPROVED',
  FULLY_APPROVED = 'FULLY_APPROVED',
  DENIED = 'DENIED',
  ADJUSTED = 'ADJUSTED',
  APPEALED = 'APPEALED',
  WRITTEN_OFF = 'WRITTEN_OFF',
  CANCELLED = 'CANCELLED',
}

export enum CareNoteType {
  SOAP = 'soap',
  ADMISSION = 'admission',
  CONSULTATION = 'consultation',
  PROCEDURE = 'procedure',
  OPERATION = 'operation',
  PROGRESS = 'progress',
  DISCHARGE = 'discharge',
  EMERGENCY = 'emergency',
  FOLLOW_UP = 'follow_up',
  ORTHOPEDIC_OPERATION = 'orthopedic_operation',
  GENERAL_EXAMINATION = 'general_examination',
}

export enum CareNoteStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  PENDING_APPROVAL = 'pending_approval',
  REJECTED = 'rejected',
  ARCHIVED = 'archived',
}

export enum AIProvider {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  GEMINI = 'gemini',
  AZURE_AI = 'azure_ai',
  CUSTOM = 'custom',
}

export enum PermissionLevel {
  READ = 'read',
  WRITE = 'write',
  ADMIN = 'admin',
  OWNER = 'owner',
}

export enum TemplateCategory {
  GENERAL = 'general',
  SPECIALIST = 'specialist',
  EMERGENCY = 'emergency',
  FOLLOW_UP = 'follow_up',
  DISCHARGE = 'discharge',
  CUSTOM = 'custom',
}

export enum AuditAction {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  VIEW = 'view',
  SHARE = 'share',
  EXPORT = 'export',
  PUBLISH = 'publish',
  ARCHIVE = 'archive',
}

export enum SickNoteStatus {
  DRAFT = 'draft',
  ISSUED = 'issued',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

export enum ReferralStatus {
  DRAFT = 'draft',
  SENT = 'sent',
  ACKNOWLEDGED = 'acknowledged',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum ReferralUrgency {
  ROUTINE = 'routine',
  URGENT = 'urgent',
  EMERGENCY = 'emergency',
}

export enum ReferralType {
  SPECIALIST = 'specialist',
  DIAGNOSTIC = 'diagnostic',
  THERAPY = 'therapy',
  SURGICAL = 'surgical',
  OTHER = 'other',
}

export enum WorkRestrictionType {
  FULL_REST = 'full_rest',
  LIGHT_DUTY = 'light_duty',
  MODIFIED_DUTY = 'modified_duty',
  NO_RESTRICTION = 'no_restriction',
  HOSPITALIZATION = 'hospitalization',
}

export enum PrescriptionStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  ON_HOLD = 'on_hold',
}

export enum JoinRequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

export enum AuditEventType {
  CREATE = 'CREATE',
  READ = 'READ',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  EXPORT = 'EXPORT',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  ACCESS_DENIED = 'ACCESS_DENIED',
  OTHER = 'OTHER',
}

export enum AuditOutcome {
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
}

export enum AuditContextStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REVERSED = 'REVERSED',
}

export enum NoteAuditActionType {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  PUBLISH = 'PUBLISH',
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  SHARE = 'SHARE',
  PERMISSION_CHANGE = 'PERMISSION_CHANGE',
  AI_GENERATE = 'AI_GENERATE',
  AI_APPROVE = 'AI_APPROVE',
  AI_REJECT = 'AI_REJECT',
  VERSION_RESTORE = 'VERSION_RESTORE',
  MODIFY = 'MODIFY',
  REVERT = 'REVERT',
}

export enum CollaborationRole {
  WORKSPACE_OWNER      = 'WORKSPACE_OWNER',
  CO_OWNER             = 'CO_OWNER',
  ADMIN                = 'ADMIN',
  MANAGER              = 'MANAGER',
  PHYSICIAN            = 'PHYSICIAN',
  DOCTOR               = 'DOCTOR',
  NURSE                = 'NURSE',
  MEDICAL_ASSISTANT    = 'MEDICAL_ASSISTANT',
  PHARMACIST           = 'PHARMACIST',
  THERAPIST            = 'THERAPIST',
  PRACTICE_ADMIN       = 'PRACTICE_ADMIN',
  BILLING_STAFF        = 'BILLING_STAFF',
  SCHEDULER            = 'SCHEDULER',
  LAB_TECHNICIAN       = 'LAB_TECHNICIAN',
  RADIOLOGY_TECHNICIAN = 'RADIOLOGY_TECHNICIAN',
  STAFF                = 'STAFF',
  READ_ONLY            = 'READ_ONLY',
  PATIENT              = 'PATIENT',
  VENDOR               = 'VENDOR',
  GUEST                = 'GUEST',
}

export enum RequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

/**
 * Background transcription pipeline status.
 * Tracks the overall state of an async transcription job.
 */
export enum TranscriptionStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  TRANSCRIBING = 'TRANSCRIBING',
  STRUCTURING = 'STRUCTURING',
  PENDING_NOTE_GENERATION = 'PENDING_NOTE_GENERATION',
  NOTE_GENERATION = 'NOTE_GENERATION',
  NOTE_GENERATED = 'NOTE_GENERATED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/**
 * Background transcription pipeline step.
 * Tracks the current step within the processing pipeline.
 */
export enum TranscriptionStep {
  UPLOAD = 'UPLOAD',
  AUDIO_PROCESSING = 'AUDIO_PROCESSING',
  TRANSCRIPTION = 'TRANSCRIPTION',
  STRUCTURING = 'STRUCTURING',
  SAVING = 'SAVING',
  PENDING_NOTE = 'PENDING_NOTE',
  NOTE_GENERATION = 'NOTE_GENERATION',
  NOTE_GENERATED = 'NOTE_GENERATED',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
}

/**
 * Transcription processing mode.
 * STANDARD  – Synchronous: the HTTP request waits for the full result.
 * BACKGROUND – Asynchronous: job is queued; client polls via processId.
 */
export enum TranscriptionMode {
  STANDARD   = 'STANDARD',
  BACKGROUND = 'BACKGROUND',
}
