import { AIProvider } from '../../../common/enums';

/**
 * AI Metadata Interface
 * Tracks AI generation metadata for audit and cost tracking
 */
export interface IAiMetadata {
  /**
   * AI provider used
   */
  provider: AIProvider;

  /**
   * Model version used
   */
  model: string;

  /**
   * Prompt sent to AI
   */
  prompt?: string;

  /**
   * Temperature setting (0-1)
   */
  temperature?: number;

  /**
   * Maximum tokens to generate
   */
  maxTokens?: number;

  /**
   * Token usage statistics
   */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };

  /**
   * Estimated cost in USD
   */
  costEstimate?: number;

  /**
   * Generation time in milliseconds
   */
  generationTimeMs?: number;

  /**
   * Timestamp of generation
   */
  timestamp: Date;

  /**
   * Source transcript ID (if from transcription)
   */
  transcriptId?: string;

  /**
   * Immutable snapshot of the structuredTranscript at the time this note was
   * generated. The live RecordingsTranscript record can be mutated after
   * generation (audio append, merge, version restore), so this field captures
   * exactly what the AI saw as input. Use this for provenance / audit.
   */
  sourceTranscript?: any;

  /**
   * Confidence score (0-1)
   */
  confidence?: number;

  /**
   * Whether generation was successful
   */
  success?: boolean;

  /**
   * Error message if failed
   */
  error?: string;
}

/**
 * Note AI Metadata Interface
 * Extended metadata for AI-generated notes
 */
export interface INoteAiMetadata extends IAiMetadata {
  /**
   * Source ID for tracking
   */
  sourceId?: string;

  /**
   * Parent note ID (if based on another note)
   */
  parentNoteId?: string;

  /**
   * Whether manually edited after AI generation
   */
  isManual?: boolean;

  /**
   * Processing status
   */
  status?: 'uploaded' | 'transcribing' | 'transcribed' | 'generating' | 'generated' | 'error';

  /**
   * Language code
   */
  language?: string;

  /**
   * Audio file size in bytes (if from audio)
   */
  fileSize?: number;

  /**
   * MIME type of source file
   */
  mimeType?: string;

  /**
   * Number of retry attempts
   */
  retryCount?: number;

  /**
   * Provider fallback chain (if multiple providers used)
   */
  providerChain?: AIProvider[];
}
