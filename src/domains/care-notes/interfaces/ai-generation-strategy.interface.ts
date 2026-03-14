import { AIProvider, CareNoteType } from '../../../common/enums';
import { ChatCompletion } from 'openai/resources/chat';

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

  getSupportedModels(operation: 'transcription' | 'generation'): string[];

  getDefaultGenerationModel(): string;

  getProvider(): AIProvider;
}
