import { Logger } from '@nestjs/common';
import { AIProvider, CareNoteType } from '../../../common/enums';
import { IAiGenerationStrategy, AiTokenUsage } from '../interfaces';
import { ChatCompletion } from 'openai/resources/chat';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Base AI Strategy Abstract Class
 * Provides common functionality for all AI provider implementations
 *
 * Features:
 * - Retry logic with exponential backoff
 * - Error handling and logging
 * - Cost estimation
 * - Performance monitoring
 * - Token usage tracking for billing
 */
export abstract class BaseAiStrategy implements IAiGenerationStrategy {
  protected readonly logger: Logger;
  protected readonly defaultTemperature = 0.7;
  protected readonly defaultMaxTokens = 2000;

  // Retry configuration
  protected readonly maxRetries = 3;
  protected readonly baseDelay = 1000; // 1 second
  protected readonly maxDelay = 10000; // 10 seconds
  protected readonly backoffMultiplier = 2;

  // Token usage tracking — set by each strategy after API calls
  protected lastTokenUsage: AiTokenUsage | null = null;

  constructor(loggerContext: string) {
    this.logger = new Logger(loggerContext);
  }

  /**
   * Returns the token usage from the most recent API call and resets the stored value.
   * Returns null if no usage data is available (e.g. transcription calls).
   */
  getLastTokenUsage(): AiTokenUsage | null {
    const usage = this.lastTokenUsage;
    this.lastTokenUsage = null;
    return usage;
  }

  /**
   * Store token usage from an API response.
   * Call this in each strategy after a successful API call.
   */
  protected setTokenUsage(inputTokens: number, outputTokens: number): void {
    this.lastTokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    };
  }

  /**
   * Transcribe audio file to text
   * Must be implemented by each provider
   */
  abstract transcribeAudio(
    filePath: string,
    language?: string,
  ): Promise<{ text: string }>;

  /**
   * Generate structured note from transcript
   * Must be implemented by each provider
   */
  abstract generateNote(options: {
    content: string;
    noteType: CareNoteType;
    template?: any;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<any>;

  /**
   * Analyze an image using AI vision and extract text / clinical findings.
   * Must be implemented by each provider.
   */
  abstract analyzeImage(
    filePath: string,
    context?: string,
    language?: string,
  ): Promise<{ text: string }>;

  /**
   * Generate structured transcript
   * Must be implemented by each provider
   */
  abstract generateStructuredTranscript(
    text: string,
    temperature: number,
    model: string,
    context: string,
  ): Promise<ChatCompletion>;

  /**
   * Health check for provider
   * Must be implemented by each provider
   */
  abstract healthCheck(): Promise<{
    healthy: boolean;
    details?: string;
  }>;

  /**
   * Get supported models
   * Must be implemented by each provider
   */
  abstract getSupportedModels(
    operation: 'transcription' | 'generation' | 'image_analysis',
  ): string[];

  /**
   * Get default generation model
   * Must be implemented by each provider
   */
  abstract getDefaultGenerationModel(): string;

  /**
   * Get provider identifier
   * Must be implemented by each provider
   */
  abstract getProvider(): AIProvider;

  /**
   * Retry operation with exponential backoff
   * @param operation Operation to retry
   * @param operationName Name for logging
   * @param operationId Unique operation ID
   * @returns Operation result
   */
  protected async retryOperation<T>(
    operation: () => Promise<T>,
    operationName: string,
    operationId: string,
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        this.logger.debug(
          `[${operationId}] Attempting ${operationName} (attempt ${attempt}/${this.maxRetries})`,
        );

        const result = await operation();

        if (attempt > 1) {
          this.logger.log(
            `[${operationId}] ${operationName} succeeded after ${attempt} attempts`,
          );
        }

        return result;
      } catch (error) {
        lastError = error as Error;

        if (attempt === this.maxRetries) {
          this.logger.error(
            `[${operationId}] ${operationName} failed after ${this.maxRetries} attempts`,
            error.stack,
          );
          break;
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          this.baseDelay * Math.pow(this.backoffMultiplier, attempt - 1),
          this.maxDelay,
        );

        this.logger.warn(
          `[${operationId}] ${operationName} failed (attempt ${attempt}/${this.maxRetries}), retrying in ${delay}ms`,
          {
            error: error.message,
            attempt,
            maxRetries: this.maxRetries,
            delay,
          },
        );

        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  /**
   * Extract error message from various error types
   * @param error Error object
   * @returns Error message string
   */
  protected extractErrorMessage(error: any): string {
    if (typeof error === 'string') {
      return error;
    }

    if (error?.message) {
      return error.message;
    }

    if (error?.error?.message) {
      return error.error.message;
    }

    return JSON.stringify(error);
  }

  /**
   * Sleep for specified milliseconds
   * @param ms Milliseconds to sleep
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Normalize language code to ISO 639-1 format
   * @param language Language code (e.g., 'en', 'en-US', 'english')
   * @returns ISO 639-1 language code
   */
  protected normalizeLanguageCode(language?: string): string {
    if (!language) {
      return 'en'; // Default to English
    }

    const lowerLang = language.toLowerCase();

    // Extract first two characters for ISO codes
    if (lowerLang.includes('-')) {
      return lowerLang.split('-')[0];
    }

    // Map common language names to ISO codes
    const languageMap: Record<string, string> = {
      english: 'en',
      spanish: 'es',
      french: 'fr',
      german: 'de',
      italian: 'it',
      portuguese: 'pt',
      russian: 'ru',
      japanese: 'ja',
      korean: 'ko',
      chinese: 'zh',
      arabic: 'ar',
      hindi: 'hi',
    };

    return languageMap[lowerLang] || lowerLang.substring(0, 2);
  }

  /**
   * Generate unique operation ID for tracking
   * @returns Unique operation ID
   */
  protected generateOperationId(prefix: string = 'op'): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 11);
    return `${prefix}_${timestamp}_${random}`;
  }

  /**
   * Estimate cost for operation (default implementation)
   * Override in specific providers for accurate pricing
   *
   * @param operation Operation type
   * @param inputSize Input size (tokens/seconds)
   * @returns Estimated cost in USD
   */
  async estimateCost(
    operation: 'transcription' | 'generation',
    inputSize: number,
  ): Promise<number> {
    // Default placeholder - override in specific strategies
    this.logger.debug(
      `Cost estimation not implemented for ${this.getProvider()}`,
    );
    return 0;
  }

  /**
   * Validate required configuration
   * @param config Configuration object
   * @param requiredKeys Required configuration keys
   * @throws Error if required keys are missing
   */
  protected validateConfig(
    config: Record<string, any>,
    requiredKeys: string[],
  ): void {
    const missing = requiredKeys.filter((key) => !config[key]);

    if (missing.length > 0) {
      throw new Error(
        `Missing required configuration: ${missing.join(', ')}`,
      );
    }
  }

  /**
   * Log performance metrics
   * @param operationId Operation ID
   * @param operationName Operation name
   * @param startTime Start timestamp
   * @param metadata Additional metadata
   */
  protected logPerformance(
    operationId: string,
    operationName: string,
    startTime: number,
    metadata?: Record<string, any>,
  ): void {
    const duration = Date.now() - startTime;

    this.logger.log(`[${operationId}] ${operationName} completed`, {
      duration: `${duration}ms`,
      ...metadata,
    });
  }

  // ===========================================================================
  // IMAGE HELPERS
  // ===========================================================================

  private static readonly ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  private static readonly MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20 MB

  private static readonly MIME_MAP: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };

  /**
   * Validate an image file before sending to an AI vision API.
   * @throws Error if the file is invalid
   */
  protected validateImageFile(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Image file not found: ${filePath}`);
    }

    const ext = path.extname(filePath).toLowerCase();
    if (!BaseAiStrategy.ALLOWED_IMAGE_EXTENSIONS.includes(ext)) {
      throw new Error(
        `Unsupported image format: ${ext}. Supported: ${BaseAiStrategy.ALLOWED_IMAGE_EXTENSIONS.join(', ')}`,
      );
    }

    const stats = fs.statSync(filePath);
    if (stats.size > BaseAiStrategy.MAX_IMAGE_SIZE) {
      throw new Error(
        `Image file too large: ${this.formatBytes(stats.size)}. Maximum: 20 MB`,
      );
    }

    if (stats.size === 0) {
      throw new Error('Image file is empty');
    }
  }

  /**
   * Read an image file and return its base64-encoded content and MIME type.
   */
  protected readImageAsBase64(filePath: string): { base64: string; mimeType: string } {
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = BaseAiStrategy.MIME_MAP[ext] || 'image/jpeg';
    const buffer = fs.readFileSync(filePath);
    return { base64: buffer.toString('base64'), mimeType };
  }

  /** Format bytes to human-readable string (e.g. "2.4 MB"). */
  protected formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
