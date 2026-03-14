import { Entity, Column, Index } from 'typeorm';
import {
  TranscriptionStatus,
  TranscriptionStep,
  TranscriptionMode,
} from '../../../common/enums';
import { AIProvider } from '../../../common/enums';
import { BaseEntity } from '../../../common/entities/base.entity';

/**
 * TranscriptionJob Entity
 *
 * Unified record for EVERY audio transcription — both synchronous (STANDARD)
 * and asynchronous (BACKGROUND) processing modes.
 *
 * Lifecycle:
 *   STANDARD   → PENDING → PROCESSING → TRANSCRIBING → STRUCTURING → COMPLETED
 *   BACKGROUND → PENDING → PROCESSING → TRANSCRIBING → STRUCTURING
 *                       → PENDING_NOTE_GENERATION → NOTE_GENERATED
 *
 * On success the job links to a RecordingsTranscript (transcriptId) and,
 * after note generation, to a CareNote (noteId).  Those two IDs are what
 * the frontend uses to "select and proceed" in the workflow.
 *
 * Design notes:
 * - All display-critical fields are typed columns (no JSON parsing needed in
 *   list queries).
 * - rawTranscribedText stores the raw STT output for audit / re-processing.
 * - transcriptPreview stores the first 500 chars of the structured transcript
 *   for fast list rendering without a JOIN to recordings_transcript.
 * - errorMessage / errorDetails replace the previous JSON metadata blob for
 *   errors so failures can be queried and filtered directly.
 * - resolvedProvider / resolvedModel capture the actual AI used when the
 *   multi-provider fallback kicks in.
 */
@Entity('transcription_jobs')
@Index(['workspaceId', 'status'])
@Index(['workspaceId', 'mode', 'status'])
@Index(['consultationId', 'status'])
@Index(['doctorId', 'status'])
@Index(['doctorId', 'mode'])
@Index(['createdAt'])
export class TranscriptionJob extends BaseEntity {

  // ── Workspace & Ownership ───────────────────────────────────────────────────

  @Column()
  workspaceId: string;

  @Column()
  doctorId: string;

  @Column()
  consultationId: string;

  /** Patient name for display in the frontend job tracker.
   *  Stored at job creation so it survives across sessions without a JOIN. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  patientName: string;

  // ── Processing Mode ─────────────────────────────────────────────────────────

  /**
   * STANDARD  – Synchronous: HTTP response returns the completed transcript.
   * BACKGROUND – Asynchronous: client receives a processId and polls for status.
   */
  @Column({
    type:    'varchar',
    length:  20,
    default: TranscriptionMode.STANDARD,
  })
  mode: TranscriptionMode;

  // ── Status & Pipeline Step ──────────────────────────────────────────────────

  @Column({
    type:    'varchar',
    length:  50,
    default: TranscriptionStatus.PENDING,
  })
  status: TranscriptionStatus;

  /**
   * Fine-grained step within the current status, used to drive the progress UI.
   * Sequence: UPLOAD → AUDIO_PROCESSING → TRANSCRIPTION → STRUCTURING
   *           → SAVING → PENDING_NOTE → NOTE_GENERATION → NOTE_GENERATED
   *           (→ ERROR on failure, → COMPLETED for STANDARD mode)
   */
  @Column({
    type:    'varchar',
    length:  50,
    default: TranscriptionStep.UPLOAD,
  })
  currentStep: TranscriptionStep;

  /** 0–100 progress percentage.  Useful for BACKGROUND mode progress bars. */
  @Column({ type: 'tinyint', unsigned: true, default: 0 })
  progressPercentage: number;

  /** Human-readable progress message displayed in the job list / status card. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  progressMessage: string;

  // ── Audio File ──────────────────────────────────────────────────────────────

  @Column()
  audioFilePath: string;

  /** File size in bytes — shown in the job list (e.g. "2.4 MB"). */
  @Column({ type: 'bigint', unsigned: true, nullable: true })
  audioFileSizeBytes: number;

  /** Audio duration in seconds — shown in the job list (e.g. "1 min 34 s"). */
  @Column({ type: 'int', unsigned: true, nullable: true })
  audioDurationSeconds: number;

  // ── AI Configuration (as requested by the caller) ───────────────────────────

  /** Requested AI provider. May differ from resolvedProvider if fallback fired. */
  @Column({ type: 'varchar', length: 50, nullable: true })
  provider: AIProvider;

  /** Requested model name. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  model: string;

  @Column({ type: 'varchar', length: 10, nullable: true, default: 'en' })
  language: string;

  @Column({
    type: 'decimal',
    precision: 3,
    scale: 2,
    nullable: true,
    // MySQL returns DECIMAL as a string at runtime; coerce back to number here
    // so every consumer receives a proper JS number, not e.g. "0.20".
    transformer: {
      to:   (v: number | null) => v,
      from: (v: string | null) => (v !== null && v !== undefined ? parseFloat(v) : null),
    },
  })
  temperature: number;

  /** Optional doctor-supplied context to guide the transcription AI. */
  @Column({ type: 'text', nullable: true })
  context: string;

  // ── Note Generation Config ──────────────────────────────────────────────────

  /**
   * Note type the doctor selected before initiating transcription.
   * Passed through to note generation when the job is "selected to proceed".
   */
  @Column({ type: 'varchar', length: 50, nullable: true })
  noteType: string;

  /** Optional template ID chosen by the doctor. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  templateId: string;

  // ── Transcription Output ────────────────────────────────────────────────────

  /**
   * Raw speech-to-text output from the AI provider.
   * Stored here for audit, debugging, and re-processing without joining
   * to the recordings_transcript table.
   */
  @Column({ type: 'text', nullable: true })
  rawTranscribedText: string;

  /**
   * First 500 characters of the structured transcript for fast list rendering.
   * Avoids a JOIN to recordings_transcript just to show a preview.
   * Full text is in RecordingsTranscript.structuredTranscript.
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  transcriptPreview: string;

  /**
   * Whether the transcript was successfully structured by the AI.
   * `true`  → job reached PENDING_NOTE_GENERATION; structuredTranscript is
   *           AI-formatted medical text. This is guaranteed for any completed job.
   * `false` → job is still PENDING/PROCESSING, or permanently FAILED.
   *           A completed job always has isStructured=true (structuring failure
   *           throws and retries rather than falling back to raw text).
   */
  @Column({ type: 'boolean', default: false })
  isStructured: boolean;

  // ── Output Links ────────────────────────────────────────────────────────────

  /**
   * ID of the RecordingsTranscript record created when the pipeline finishes.
   * Populated when status reaches COMPLETED or PENDING_NOTE_GENERATION.
   * This is the ID the frontend uses to "select a job and proceed to note
   * generation".
   */
  @Column({ nullable: true })
  transcriptId: string;

  /**
   * ID of the CareNote generated from this transcription.
   * Populated when status reaches NOTE_GENERATED.
   */
  @Column({ nullable: true })
  noteId: string;

  // ── Resolved AI Details (actual provider/model used) ────────────────────────

  /**
   * Actual provider that processed the audio — may differ from `provider`
   * when the multi-provider fallback chain was triggered.
   */
  @Column({ type: 'varchar', length: 50, nullable: true })
  resolvedProvider: string;

  /** Actual model used (may differ from `model` after fallback). */
  @Column({ type: 'varchar', length: 100, nullable: true })
  resolvedModel: string;

  /** Wall-clock time from startedAt → completedAt in milliseconds. */
  @Column({ type: 'int', unsigned: true, nullable: true })
  processingTimeMs: number;

  // ── Reliability ─────────────────────────────────────────────────────────────

  /** Number of processing attempts.  Incremented on each retry (max 3 for BACKGROUND). */
  @Column({ type: 'tinyint', unsigned: true, default: 0 })
  retryCount: number;

  /** Short error message suitable for display in the UI. */
  @Column({ type: 'varchar', length: 1000, nullable: true })
  errorMessage: string;

  /** Full error details as a JSON string for developer debugging. */
  @Column({ type: 'text', nullable: true })
  errorDetails: string;

  // ── Timestamps ──────────────────────────────────────────────────────────────

  /** When the job actually began processing (after any queue wait). */
  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date;

  /** When the transcription pipeline finished and the transcript was saved. */
  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date;

  /** When the associated clinical note was generated (if applicable). */
  @Column({ type: 'timestamp', nullable: true })
  noteGeneratedAt: Date;

  // ===========================================================================
  // State Transition Helpers
  // ===========================================================================

  markAsProcessing(): void {
    this.status          = TranscriptionStatus.PROCESSING;
    this.currentStep     = TranscriptionStep.AUDIO_PROCESSING;
    this.startedAt       = new Date();
    this._progress(TranscriptionStep.AUDIO_PROCESSING, 10, 'Processing audio file…');
  }

  markAsTranscribing(): void {
    this.status      = TranscriptionStatus.TRANSCRIBING;
    this.currentStep = TranscriptionStep.TRANSCRIPTION;
    this._progress(TranscriptionStep.TRANSCRIPTION, 30, 'Transcribing audio…');
  }

  /** Call once the raw STT text is available. */
  markAsTranscribed(rawText: string): void {
    this.rawTranscribedText = rawText;
    this.currentStep        = TranscriptionStep.STRUCTURING;
    this._progress(TranscriptionStep.STRUCTURING, 55, 'Audio transcribed, structuring content…');
  }

  markAsStructuring(): void {
    this.status      = TranscriptionStatus.STRUCTURING;
    this.currentStep = TranscriptionStep.STRUCTURING;
    this._progress(TranscriptionStep.STRUCTURING, 70, 'Generating structured transcript…');
  }

  markAsSaving(): void {
    this.currentStep = TranscriptionStep.SAVING;
    this._progress(TranscriptionStep.SAVING, 90, 'Saving to database…');
  }

  /**
   * Call when the RecordingsTranscript has been saved.
   *
   * STANDARD  → status becomes COMPLETED
   * BACKGROUND → status becomes PENDING_NOTE_GENERATION (doctor must pick it up)
   *
   * @param transcriptId  ID of the saved RecordingsTranscript
   * @param structuredText  Pass the structured text so a 500-char preview is stored.
   * @param resolvedProvider  Actual provider used (after any fallback).
   * @param resolvedModel     Actual model used.
   * @param isStructured      Whether the AI successfully structured the transcript.
   */
  markAsCompleted(
    transcriptId: string,
    structuredText?: string,
    resolvedProvider?: string,
    resolvedModel?: string,
    isStructured?: boolean,
  ): void {
    const isBackground     = this.mode === TranscriptionMode.BACKGROUND;
    this.status            = isBackground
      ? TranscriptionStatus.PENDING_NOTE_GENERATION
      : TranscriptionStatus.COMPLETED;
    this.currentStep       = isBackground
      ? TranscriptionStep.PENDING_NOTE
      : TranscriptionStep.COMPLETED;
    this.transcriptId      = transcriptId;
    this.completedAt       = new Date();
    if (this.startedAt) {
      this.processingTimeMs = Date.now() - this.startedAt.getTime();
    }
    if (structuredText) {
      this.transcriptPreview = structuredText.slice(0, 500);
    }
    if (resolvedProvider) this.resolvedProvider = resolvedProvider;
    if (resolvedModel)    this.resolvedModel    = resolvedModel;
    if (isStructured !== undefined) this.isStructured = isStructured;

    const msg = isBackground
      ? 'Transcription complete — ready for note generation'
      : 'Transcription complete';
    this._progress(this.currentStep, 100, msg);
  }

  markAsNoteGenerating(): void {
    this.status      = TranscriptionStatus.NOTE_GENERATION;
    this.currentStep = TranscriptionStep.NOTE_GENERATION;
    this._progress(TranscriptionStep.NOTE_GENERATION, 95, 'Generating clinical note…');
  }

  markAsNoteGenerated(noteId: string): void {
    this.status          = TranscriptionStatus.NOTE_GENERATED;
    this.currentStep     = TranscriptionStep.NOTE_GENERATED;
    this.noteId          = noteId;
    this.noteGeneratedAt = new Date();
    this._progress(TranscriptionStep.NOTE_GENERATED, 100, 'Clinical note generated successfully');
  }

  markAsFailed(error: string, details?: Record<string, any>): void {
    this.status       = TranscriptionStatus.FAILED;
    this.currentStep  = TranscriptionStep.ERROR;
    this.errorMessage = error;
    if (details) {
      this.errorDetails = JSON.stringify(details);
    }
    this._progress(TranscriptionStep.ERROR, 0, `Failed: ${error}`);
  }

  markAsCancelled(): void {
    this.status      = TranscriptionStatus.CANCELLED;
    this.currentStep = TranscriptionStep.ERROR;
    this._progress(TranscriptionStep.ERROR, 0, 'Transcription cancelled by user');
  }

  // ===========================================================================
  // Query / UI Helpers
  // ===========================================================================

  /**
   * True when the transcript is ready and a clinical note can be generated.
   * Covers both STANDARD (COMPLETED) and BACKGROUND (PENDING_NOTE_GENERATION).
   */
  isReadyForNoteGeneration(): boolean {
    return (
      this.status === TranscriptionStatus.COMPLETED ||
      this.status === TranscriptionStatus.PENDING_NOTE_GENERATION
    ) && !!this.transcriptId;
  }

  hasNoteGenerated(): boolean {
    return this.status === TranscriptionStatus.NOTE_GENERATED && !!this.noteId;
  }

  /** True when the job has reached a terminal state (success, failure, or cancel). */
  isTerminal(): boolean {
    return [
      TranscriptionStatus.COMPLETED,
      TranscriptionStatus.PENDING_NOTE_GENERATION,
      TranscriptionStatus.NOTE_GENERATED,
      TranscriptionStatus.FAILED,
      TranscriptionStatus.CANCELLED,
    ].includes(this.status);
  }

  canCancel(): boolean {
    return !this.isTerminal();
  }

  canRetry(): boolean {
    return this.status === TranscriptionStatus.FAILED && this.retryCount < 3;
  }

  /** Parses errorDetails JSON; returns empty object on malformed data. */
  getErrorDetails(): Record<string, any> {
    try {
      return this.errorDetails ? JSON.parse(this.errorDetails) : {};
    } catch {
      return {};
    }
  }

  /**
   * Returns the minimal projection needed by the frontend job-list endpoint.
   * All fields are direct columns — no JSON parsing required.
   */
  toListItem(): {
    id: string;
    mode: TranscriptionMode;
    status: TranscriptionStatus;
    currentStep: TranscriptionStep;
    progressPercentage: number;
    progressMessage: string;
    consultationId: string;
    doctorId: string;
    patientName: string;
    noteType: string;
    audioFileSizeBytes: number;
    audioDurationSeconds: number;
    transcriptPreview: string;
    isStructured: boolean;
    transcriptId: string;
    noteId: string;
    resolvedProvider: string;
    resolvedModel: string;
    processingTimeMs: number;
    retryCount: number;
    errorMessage: string;
    startedAt: Date;
    completedAt: Date;
    noteGeneratedAt: Date;
    createdAt: Date;
  } {
    return {
      id:                  this.id,
      mode:                this.mode,
      status:              this.status,
      currentStep:         this.currentStep,
      progressPercentage:  this.progressPercentage,
      progressMessage:     this.progressMessage,
      consultationId:      this.consultationId,
      doctorId:            this.doctorId,
      patientName:         this.patientName,
      noteType:            this.noteType,
      audioFileSizeBytes:  this.audioFileSizeBytes,
      audioDurationSeconds: this.audioDurationSeconds,
      transcriptPreview:   this.transcriptPreview,
      isStructured:        this.isStructured,
      transcriptId:        this.transcriptId,
      noteId:              this.noteId,
      resolvedProvider:    this.resolvedProvider,
      resolvedModel:       this.resolvedModel,
      processingTimeMs:    this.processingTimeMs,
      retryCount:          this.retryCount,
      errorMessage:        this.errorMessage,
      startedAt:           this.startedAt,
      completedAt:         this.completedAt,
      noteGeneratedAt:     this.noteGeneratedAt,
      createdAt:           this.createdAt,
    };
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private _progress(
    step: TranscriptionStep | string,
    percentage: number,
    message?: string,
  ): void {
    this.progressPercentage = percentage;
    if (message) this.progressMessage = message;
  }
}
