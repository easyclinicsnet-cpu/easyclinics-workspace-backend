import { AIProvider, CareNoteType } from '../../../common/enums';
import { ChatCompletion } from 'openai/resources/chat';

/**
 * Token usage data captured from AI provider responses.
 */
export interface AiTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * AI Generation Strategy Interface
 * Defines contract for AI provider implementations (OpenAI, Anthropic, Gemini)
 *
 * Exact match with legacy IAiGenerationStrategy interface
 */
export interface IAiGenerationStrategy {
  transcribeAudio(
    filePath: string,
    language?: string,
  ): Promise<{ text: string }>;

  analyzeImage(
    filePath: string,
    context?: string,
    language?: string,
  ): Promise<{ text: string }>;

  generateNote(options: {
    content: string;
    noteType: CareNoteType;
    template?: any;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<any>;

  generateStructuredTranscript(
    text: string,
    temperature: number,
    model: string,
    context: string,
  ): Promise<ChatCompletion>;

  healthCheck(): Promise<{ healthy: boolean; details?: string }>;

  getSupportedModels(operation: 'transcription' | 'generation' | 'image_analysis'): string[];

  getDefaultGenerationModel(): string;

  getProvider(): AIProvider;

  /**
   * Returns the token usage from the most recent API call.
   * Resets to null after reading. Returns null if no usage data is available
   * (e.g. transcription calls that don't report tokens).
   */
  getLastTokenUsage(): AiTokenUsage | null;
}
