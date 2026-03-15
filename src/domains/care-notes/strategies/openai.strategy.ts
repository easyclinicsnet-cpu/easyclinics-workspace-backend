import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { AIProvider, CareNoteType } from '../../../common/enums';
import { AudioProcessor } from '../../../common/file-upload/audio-optimizer.service';
import { AudioChunk } from '../../../common/interfaces/audio-chunk.interface';
import { LoggerService } from '../../../common/logger/logger.service';

interface OpenAIApiError extends Error {
  status?: number;
  code?: string;
  type?: string;
  param?: string;
}

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

interface TranscriptionResult {
  text: string;
  chunks?: number;
  duration?: number;
  strategy?: 'single' | 'chunked' | 'parallel';
}

@Injectable()
export class OpenAiStrategy {
  private openai: OpenAI;
  private readonly logger: LoggerService;
  private readonly defaultGenerationModel = 'gpt-4-turbo';
  private readonly supportedChatModels = [
    'gpt-5',
    'gpt-4o',
    'gpt-4-turbo',
    'gpt-4',
    'gpt-3.5-turbo',
    'gpt-3.5-turbo-16k',
  ];

  // Performance configuration
  private readonly SMALL_FILE_THRESHOLD_MINUTES = 3; // Files under 5 min: single transcription
  private readonly MEDIUM_FILE_THRESHOLD_MINUTES = 5; // Files 5-15 min: single with extended timeout
  private readonly CHUNK_SIZE_MINUTES = 3; // Optimal chunk size for parallel processing
  private readonly MAX_PARALLEL_CHUNKS = 10; // Process up to 4 chunks simultaneously

  // Enhanced retry configuration
  private readonly retryConfig: RetryConfig = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
  };

  constructor(
    private configService: ConfigService,
    private audioProcessor: AudioProcessor,
  ) {
    this.logger = new LoggerService('OpenAiStrategy');
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const timeout = this.configService.get<number>('OPENAI_TIMEOUT') || 600000;

    if (!apiKey) {
      this.logger.error('OPENAI_API_KEY is not configured');
      throw new Error('OpenAI API key is required');
    }

    this.openai = new OpenAI({
      apiKey,
      timeout,
      maxRetries: this.retryConfig.maxRetries,
      dangerouslyAllowBrowser: false,
    });

    this.logger.log(
      `OpenAI Strategy initialized: timeout=${timeout}ms, maxRetries=${this.retryConfig.maxRetries}`,
    );
  }

  async healthCheck(): Promise<{ healthy: boolean; details?: string }> {
    const operationId = `health_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      this.logger.debug(`[${operationId}] Performing OpenAI health check`);

      await this.retryOperation(
        async () => await this.openai.models.list(),
        'health check',
        operationId,
      );

      this.logger.log(`[${operationId}] OpenAI health check passed`);
      return { healthy: true };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);

      this.logger.error(`[${operationId}] OpenAI health check failed`, errorMessage);

      return {
        healthy: false,
        details: `OpenAI API health check failed: ${errorMessage}`,
      };
    }
  }

  /**
   * OPTIMIZED: Intelligent audio transcription with adaptive strategy
   * - Small files (< 5 min): Single fast transcription
   * - Medium files (5-15 min): Single with extended timeout
   * - Large files (> 15 min): Parallel chunked processing
   */
  async transcribeAudio(
    filePath: string,
    language?: string,
  ): Promise<TranscriptionResult> {
    const operationId = `transcribe_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    try {
      const isoLanguage = this.normalizeLanguageCode(language);

      this.logger.log(`[${operationId}] Starting optimized transcription`);

      // Validate file
      const { absolutePath, stats, fileExt } = await this.validateAudioFile(
        filePath,
        operationId,
      );

      // Get audio duration to determine strategy
      const durationSeconds =
        await this.audioProcessor.getAudioDuration(absolutePath);
      const durationMinutes = durationSeconds / 60;

      this.logger.log(
        `[${operationId}] Audio analysis: ${durationMinutes.toFixed(2)} minutes, ${this.formatBytes(stats.size)}`,
      );

      // Choose optimal transcription strategy
      let result: TranscriptionResult;

      if (durationMinutes <= this.SMALL_FILE_THRESHOLD_MINUTES) {
        // STRATEGY 1: Fast single transcription for small files
        this.logger.log(`[${operationId}] Using FAST strategy (< 5 min)`);
        result = await this.transcribeSingle(
          absolutePath,
          isoLanguage,
          operationId,
        );
        result.strategy = 'single';
      } else if (durationMinutes <= this.MEDIUM_FILE_THRESHOLD_MINUTES) {
        // STRATEGY 2: Single transcription with extended timeout for medium files
        this.logger.log(`[${operationId}] Using EXTENDED strategy (5-15 min)`);
        result = await this.transcribeSingle(
          absolutePath,
          isoLanguage,
          operationId,
        );
        result.strategy = 'single';
      } else {
        // STRATEGY 3: Parallel chunked processing for large files
        this.logger.log(`[${operationId}] Using PARALLEL strategy (> 15 min)`);
        result = await this.transcribeParallelChunked(
          absolutePath,
          isoLanguage,
          durationSeconds,
          operationId,
        );
        result.strategy = 'parallel';
      }

      const totalTime = Date.now() - startTime;
      result.duration = totalTime;

      this.logger.log(`[${operationId}] Transcription completed`);

      return result;
    } catch (error) {
      this.logger.error(`[${operationId}] Transcription failed`, this.extractErrorMessage(error));

      if (this.isOpenAIAPIError(error)) {
        throw this.mapTranscriptionError(error);
      }

      if (this.isConnectionError(error)) {
        throw new Error(
          'Failed to connect to OpenAI API. Please check your internet connection and firewall settings.',
        );
      }

      if (error instanceof Error) {
        throw new Error(`Transcription failed: ${error.message}`);
      }

      throw new Error('Transcription failed due to an unknown error');
    }
  }

  /**
   * Single transcription for small to medium files
   * Optimized with retry logic and proper stream handling
   */
  private async transcribeSingle(
    filePath: string,
    language: string | undefined,
    operationId: string,
  ): Promise<TranscriptionResult> {
    const startTime = Date.now();

    const transcription = await this.retryOperation(
      async () => {
        const stream = fs.createReadStream(filePath);

        try {
          const requestParams: any = {
            file: stream,
            model: 'whisper-1',
            response_format: 'json',
            temperature: 0.0,
          };

          if (language) {
            requestParams.language = language;
          }

          const result =
            await this.openai.audio.transcriptions.create(requestParams);

          if (!result?.text) {
            throw new Error('Received empty transcription from OpenAI');
          }

          return result;
        } finally {
          if (stream && !stream.destroyed) {
            stream.destroy();
          }
        }
      },
      'transcription',
      operationId,
      {
        onRetry: (attempt, error) => {
          this.logger.warn(
            `[${operationId}] Transcription attempt ${attempt} failed, retrying...`, this.extractErrorMessage(error)
          );
        },
      },
    );

    return {
      text: transcription.text,
      duration: Date.now() - startTime,
    };
  }

  /**
   * OPTIMIZED: Parallel chunked transcription for large files
   * Processes multiple chunks simultaneously for maximum speed
   */
  private async transcribeParallelChunked(
    filePath: string,
    language: string | undefined,
    durationSeconds: number,
    operationId: string,
  ): Promise<TranscriptionResult> {
    const startTime = Date.now();

    this.logger.log(`[${operationId}] Starting parallel chunked transcription`);

    // Split audio into optimal chunks
    const chunks = await this.audioProcessor.splitAudioFile(
      filePath,
      this.CHUNK_SIZE_MINUTES,
    );

    this.logger.log(`[${operationId}] Created ${chunks.length} chunks`);

    // Process chunks in parallel batches
    const transcriptions: string[] = [];
    const batchSize = this.MAX_PARALLEL_CHUNKS;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, Math.min(i + batchSize, chunks.length));
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(chunks.length / batchSize);

      this.logger.log(
        `[${operationId}] Processing batch ${batchNumber}/${totalBatches}`,
      );

      // Process batch in parallel
      const batchResults = await Promise.all(
        batch.map((chunk, batchIndex) =>
          this.transcribeChunk(
            chunk,
            language,
            i + batchIndex,
            chunks.length,
            operationId,
          ),
        ),
      );

      transcriptions.push(...batchResults);
    }

    // Merge transcriptions with timestamps
    const mergedText = this.audioProcessor.mergeTranscriptions(
      chunks,
      transcriptions,
      true, // Add timestamps for large files
    );

    // Cleanup temporary chunk files
    await this.audioProcessor.cleanupChunks(chunks);

    return {
      text: mergedText,
      chunks: chunks.length,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Transcribe a single chunk with retry logic
   */
  private async transcribeChunk(
    chunk: AudioChunk,
    language: string | undefined,
    index: number,
    total: number,
    operationId: string,
  ): Promise<string> {
    const chunkId = `${operationId}_chunk_${index}`;
    const startTime = Date.now();

    try {
      this.logger.debug(
        `[${chunkId}] Transcribing chunk ${index + 1}/${total}`,
      );

      const result = await this.retryOperation(
        async () => {
          const stream = fs.createReadStream(chunk.path);

          try {
            const requestParams: any = {
              file: stream,
              model: 'whisper-1',
              response_format: 'json',
              temperature: 0.0,
            };

            if (language) {
              requestParams.language = language;
            }

            const transcription =
              await this.openai.audio.transcriptions.create(requestParams);

            if (!transcription?.text) {
              throw new Error('Empty transcription received');
            }

            return transcription.text;
          } finally {
            if (stream && !stream.destroyed) {
              stream.destroy();
            }
          }
        },
        `chunk ${index + 1}/${total}`,
        chunkId,
      );

      const duration = Date.now() - startTime;
      this.logger.debug(`[${chunkId}] Chunk completed in ${duration}ms`);

      return result;
    } catch (error) {
      this.logger.error(`[${chunkId}] Chunk transcription failed`, this.extractErrorMessage(error));
      throw error;
    }
  }

  /**
   * Validate audio file and return file info
   */
  private async validateAudioFile(
    filePath: string,
    operationId: string,
  ): Promise<{
    absolutePath: string;
    stats: fs.Stats;
    fileExt: string;
  }> {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('Invalid file path: must be a non-empty string');
    }

    const absolutePath = path.resolve(filePath);

    try {
      await fs.promises.access(absolutePath, fs.constants.R_OK);
    } catch {
      throw new Error(`File not found or not readable: ${absolutePath}`);
    }

    const stats = await fs.promises.stat(absolutePath);

    if (stats.size === 0) {
      throw new Error('File is empty');
    }

    const maxSize = 25 * 1024 * 1024;
    if (stats.size > maxSize) {
      throw new Error(
        `File too large for single upload: ${this.formatBytes(stats.size)} (max: ${this.formatBytes(maxSize)}). File will be automatically split.`,
      );
    }

    const allowedFormats = [
      '.mp3',
      '.mp4',
      '.mpeg',
      '.mpga',
      '.m4a',
      '.wav',
      '.webm',
    ];
    const fileExt = path.extname(absolutePath).toLowerCase();
    if (!allowedFormats.includes(fileExt)) {
      throw new Error(
        `Unsupported file format: ${fileExt}. Allowed: ${allowedFormats.join(', ')}`,
      );
    }

    this.logger.debug(`[${operationId}] File validation passed`);

    return { absolutePath, stats, fileExt };
  }

  /**
   * Retry operation with exponential backoff
   */
  private async retryOperation<T>(
    operation: () => Promise<T>,
    operationType: string,
    operationId: string,
    options?: {
      onRetry?: (attempt: number, error: any) => void;
    },
  ): Promise<T> {
    let lastError: any;
    let delay = this.retryConfig.baseDelay;

    for (let attempt = 1; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (!this.isRetryableError(error)) {
          this.logger.warn(
            `[${operationId}] ${operationType} failed with non-retryable error`,
          );
          throw error;
        }

        if (attempt === this.retryConfig.maxRetries) {
          this.logger.error(
            `[${operationId}] ${operationType} failed after ${attempt} attempts`, this.extractErrorMessage(error)
          );
          break;
        }

        if (options?.onRetry) {
          options.onRetry(attempt, error);
        }

        this.logger.debug(
          `[${operationId}] Waiting ${delay}ms before retry attempt ${attempt + 1}`,
        );
        await this.sleep(delay);

        delay = Math.min(
          delay * this.retryConfig.backoffMultiplier,
          this.retryConfig.maxDelay,
        );
      }
    }

    throw lastError;
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: any): boolean {
    if (this.isConnectionError(error)) {
      return true;
    }

    if (this.isOpenAIAPIError(error)) {
      const retryableStatuses = [408, 429, 500, 502, 503, 504];
      return retryableStatuses.includes(error.status || 0);
    }

    if (
      error.code &&
      ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(error.code)
    ) {
      return true;
    }

    return false;
  }

  /**
   * Check if error is a connection error
   */
  private isConnectionError(error: any): boolean {
    if (!error) return false;

    const errorMessage = this.extractErrorMessage(error).toLowerCase();
    const connectionErrorPatterns = [
      'connection error',
      'network error',
      'econnrefused',
      'econnreset',
      'etimedout',
      'enotfound',
      'socket hang up',
      'request timeout',
      'eai_again',
    ];

    return connectionErrorPatterns.some((pattern) =>
      errorMessage.includes(pattern),
    );
  }

  /**
   * Extract error message from various error types
   */
  private extractErrorMessage(error: any): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    if (error && typeof error === 'object') {
      return error.message || error.error || JSON.stringify(error);
    }
    return 'Unknown error';
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async generateStructuredTranscript(
    text: string,
    temperature: number,
    model: string,
    context: string,
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    this.logger.debug(`ChatModel: ${model}, temperature: ${temperature}`);

    const messages: OpenAIChatMessage[] = [
      {
        role: 'system',
        content: `You are an AI medical assistant designed to assist doctors in creating detailed and accurate case notes based on patient transcriptions.
      Your primary task is to analyze the transcription, extract relevant information, and organize it into a structured and professional medical note that is clear, and ready for the doctor to review and edit.
      The output should adhere to medical documentation standards and use proper medical terminology. N.B: Do not put asterisk on and sub section e.g. **Social History:**
      Ensure the output is structured in a way that includes clearly labeled sections. If treatments are prescribed, write them nicely and then provide them under Treatment(s) Prescribed section.
      For treatment prescribed, make sure to use medical abbreviation e.g Once a day as OD or as needed as PRN (ponstan 125 mg po tds 5 days) etc. For diagnosis use the latest version of International Classification of Diseases.
      Make sure to follow this because the data is going to be saved in a well structured system.

    CRITICAL PRESCRIPTION PROCESSING RULES:
    1. ACCURATELY IDENTIFY ALL MEDICATION ORDERS including inpatient-specific administration routes:
       - IV (intravenous): e.g., "ceftriaxone 1g IV stat", "normal saline 1L IV over 8 hours"
       - IM (intramuscular): e.g., "diclofenac 75mg IM stat"
       - SC/SubQ (subcutaneous): e.g., "enoxaparin 40mg SC daily"
       - IV infusion: e.g., "dopamine 5mcg/kg/min IV infusion"
       - IV push/bolus: e.g., "furosemide 40mg IV push stat"
       - NGT (nasogastric tube): e.g., "sucralfate 1g via NGT q6h"
       - PR (per rectum): e.g., "diazepam 10mg PR stat"

    2. FOR INPATIENT ORDERS, capture these key elements:
       - Medication name, dose, route, frequency, and duration
       - STAT/ASAP orders vs scheduled/standing orders
       - PRN (pro re nata) medications with indications
       - IV fluids with rate and duration
       - Continuous infusions with rates

    3. Use STANDARD MEDICAL ABBREVIATIONS:
       - Frequency: OD (once daily), BD (twice daily), TDS (three times daily), QID (four times daily), Q6H (every 6 hours), Q8H (every 8 hours), Q12H (every 12 hours)
       - Route: PO (per oral), IV (intravenous), IM (intramuscular), SC/SubQ (subcutaneous), PR (per rectal), TOP (topical), INH (inhalation)
       - Timing: STAT (immediately), PRN (as needed), AC (before meals), PC (after meals), HS (at bedtime)
       - Duration: x5 days, x7 days, x10 days, etc.

    4. STRUCTURE TREATMENT SECTION as follows:
       - For inpatients: List under "Treatment Plan" with clear subheadings:
         * "Medications" (all drug orders)
         * "IV Fluids & Infusions"
         * "Procedures & Monitoring"
         * "PRN Medications"
       - For outpatients: List under "Treatment(s) Prescribed"

    5. FORMATTING RULES:
       - Never use asterisks (**) for section headings
       - Use clear labeled sections with proper medical headings
       - List medications in bullet points or numbered lists
       - Include diagnosis codes (ICD-10/ICD-11) when possible

    6. INPATIENT SPECIFIC NOTES:
       - Clearly distinguish between admission orders and ongoing treatment
       - Include monitoring parameters (vitals, labs, imaging)
       - Note any consults or referrals
       - Document procedures performed or planned`,
      },
      {
        role: 'user',
        content: `The following is a transcription of a real-time session between a doctor and a patient. This may include inpatient encounters with detailed medication orders and treatment plans.

    Patient transcription: "${text}".
    Additional Patient context provided: "${context}"

    Your task:
    1. Convert the transcription into a structured and professional medical note.
    2. ACCURATELY EXTRACT ALL PRESCRIPTIONS, paying special attention to:
       - Inpatient routes (IV, IM, SC, NGT, PR)
       - IV fluids with rates and durations
       - STAT vs scheduled medications
       - PRN medications with clear indications
       - Continuous infusions
    3. Structure the treatment section appropriately:
       - For inpatient encounters: Use "Treatment Plan" with subheadings
       - For outpatient encounters: Use "Treatment(s) Prescribed"
    4. Maintain a formal tone and use standard medical terminology.
    5. Present the note in a format suitable for a doctor's review and further editing.
    6. Use ICD-10/ICD-11 codes for diagnoses when possible.
    7. NEVER put asterisks on section headings.
    8. Do not put placeholder patient or doctor details if they are not mentioned.
    9. Ensure the output is structured with clearly labeled sections.

    EXAMPLE INPATIENT FORMAT:
    Treatment Plan:
    Medications:
    1. Ceftriaxone 2g IV q24h x7 days
    2. Metronidazole 500mg IV q8h x7 days
    3. Paracetamol 1g IV q6h PRN for temperature >38.5°C

    IV Fluids & Infusions:
    1. Normal saline 1L IV at 125mL/hour
    2. Potassium chloride 20mmol in 1L normal saline IV over 8 hours

    Procedures & Monitoring:
    1. Daily full blood count, renal function, CRP
    2. Chest X-ray on day 3
    3. Vital signs 4-hourly

    PRN Medications:
    1. Ondansetron 4mg IV q8h PRN for nausea/vomiting
    2. Morphine 2mg IV q4h PRN for severe pain`,
      },
    ];

    try {
      this.logger.debug(
        'Sending case summary generation request to OpenAI with retry logic.',
      );

      const usesCompletionTokens = model.startsWith('gpt-5') || model.startsWith('o');
      const tokenParam = usesCompletionTokens
        ? { max_completion_tokens: 1500 }
        : { max_tokens: 1500 };

      const response = await this.retryOperation(
        async () => {
          return await this.openai.chat.completions.create({
            model,
            messages,
            ...tokenParam,
            stream: false as const,
            temperature,
            top_p: 0.9,
          });
        },
        'case summary generation',
        `generate_${Date.now()}`,
      );

      if (!response?.choices || !Array.isArray(response.choices)) {
        throw new Error('Invalid response structure from OpenAI API');
      }

      if (response.choices.length === 0) {
        throw new Error('No choices returned from OpenAI API');
      }

      if (response.choices[0].finish_reason === 'length') {
        this.logger.warn('OpenAI response was truncated due to token limit');
      }

      return response;
    } catch (error) {
      this.logger.error('Case summary generation error', this.extractErrorMessage(error));

      if (this.isConnectionError(error)) {
        throw new Error(
          'Failed to connect to OpenAI API for text generation. Please check your internet connection.',
        );
      }

      if (error instanceof OpenAI.APIError) {
        switch (error.status) {
          case 401:
            throw new Error('OpenAI API authentication failed');
          case 429:
            throw new Error('OpenAI API rate limit exceeded');
          case 500:
            throw new Error('OpenAI API server error');
          default:
            throw new Error(`OpenAI API error: ${error.message}`);
        }
      }

      throw new Error('Failed to generate case summary');
    }
  }

  async generateNote(options: {
    content: string;
    noteType: CareNoteType;
    template?: any;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<Record<string, any>> {
    const operationId = `generate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      // Validate and select appropriate model for generation
      const modelToUse = this.validateAndSelectModel(options.model);

      this.logger.log(`[${operationId}] Starting note generation`);

      // Input validation
      if (!options.content || options.content.trim().length === 0) {
        throw new Error('Content cannot be empty for note generation');
      }

      if (
        options.temperature &&
        (options.temperature < 0 || options.temperature > 2)
      ) {
        throw new Error('Temperature must be between 0 and 2');
      }

      if (options.maxTokens && options.maxTokens < 1) {
        throw new Error('Max tokens must be a positive number');
      }

      this.logger.debug(`ChatModel: ${modelToUse}, temperature: ${options.temperature || 0.0}`);

      // Build system and user messages
      const messages: OpenAIChatMessage[] = [
        {
          role: 'system',
          content: this.buildSystemPrompt(options.noteType),
        },
        {
          role: 'user',
          content: this.buildUserPrompt(options),
        },
      ];

      this.logger.debug(
        `[${operationId}] Sending request to OpenAI chat completion with model: ${modelToUse}`,
      );

      // gpt-5.x and o-series models require max_completion_tokens; legacy models use max_tokens
      const usesCompletionTokens = modelToUse.startsWith('gpt-5') || modelToUse.startsWith('o');
      const tokenParam = usesCompletionTokens
        ? { max_completion_tokens: options.maxTokens || 4000 }
        : { max_tokens: options.maxTokens || 1000 };

      const response: OpenAI.Chat.Completions.ChatCompletion =
        await this.openai.chat.completions.create({
          model: modelToUse,
          messages,
          temperature: options.temperature || 0.0,
          ...tokenParam,
          stream: false as const,
          top_p: 0.9,
          response_format: { type: 'json_object' },
        });

      // Validate the response structure
      if (!response?.choices || !Array.isArray(response.choices)) {
        throw new Error('Invalid response structure from OpenAI API');
      }

      if (response.choices.length === 0) {
        throw new Error('No choices returned from OpenAI API');
      }

      // Optional: Log warning if response was truncated
      if (response.choices[0].finish_reason === 'length') {
        this.logger.warn(
          `[${operationId}] OpenAI response was truncated due to token limit`,
        );
      }

      // Safely handle possible null content
      const responseContent = response.choices[0]?.message?.content;

      if (!responseContent) {
        throw new Error('AI response content is empty or null');
      }

      this.logger.debug(`[${operationId}] Received response from OpenAI`);

      let parsedResult: Record<string, any>;

      try {
        // Use comprehensive JSON extraction strategy
        const extractedJson = this.extractJsonFromResponse(responseContent);

        if (!extractedJson) {
          throw new Error('No JSON content could be extracted from response');
        }

        // Attempt to parse as JSON
        parsedResult = JSON.parse(extractedJson);

        // Validate the parsed result structure
        this.validateNoteStructure(parsedResult, options.noteType);

        // Normalize — remove duplicates/extra wrapping GPT sometimes adds
        parsedResult = this.normalizeNoteContent(parsedResult, options.noteType);

        this.logger.debug(`[${operationId}] JSON parsing successful`);
      } catch (parseError) {
        this.logger.warn(
          `[${operationId}] JSON parsing failed, attempting fallback strategies`,
        );

        // Fallback: Try to fix common JSON issues and parse again
        try {
          const fixedJson = this.fixCommonJsonIssues(responseContent);
          parsedResult = JSON.parse(fixedJson);

          this.logger.debug(
            `[${operationId}] Fallback JSON parsing successful`,
          );
        } catch (fallbackError) {
          this.logger.error(
            `[${operationId}] All JSON parsing strategies failed, using raw content`,
          );

          // Final fallback: return raw content wrapped in object
          parsedResult = {
            content: responseContent,
            _parseError: true,
            _originalResponse: responseContent,
          };
        }
      }

      this.logger.log(
        `[${operationId}] Note generation completed successfully`,
      );

      return parsedResult;
    } catch (error) {
      this.logger.error(`[${operationId}] Note generation failed`, this.extractErrorMessage(error));

      // More specific error handling
      if (error instanceof OpenAI.APIError) {
        switch (error.status) {
          case 401:
            throw new Error('OpenAI API authentication failed');
          case 429:
            throw new Error('OpenAI API rate limit exceeded');
          case 500:
            throw new Error('OpenAI API server error');
          default:
            throw new Error(`OpenAI API error: ${error.message}`);
        }
      }

      throw new Error('Failed to generate note');
    }
  }

  /**
   * Build comprehensive system prompt based on note type
   */
  private buildSystemPrompt(noteType: CareNoteType): string {
    const medicalDocumentationStandards = `You are an AI medical assistant designed to assist doctors in creating structured and detailed notes.
Please note that the session is conducted and this is a real life case.
This is AI assisted notes generation for an EMR in production.

CRITICAL DATA ACCURACY RULES:
1. ONLY include data that is explicitly provided in the clinical content
2. NEVER add placeholder data, dummy data, or assumed information
3. If a field is not mentioned, OMIT it entirely from the JSON output
4. DO NOT add default values for optional fields
5. Empty arrays should be omitted, not included as []

CRITICAL INSTRUCTIONS:
1. DO NOT MISS ANY DETAIL from provided Notes
2. DO NOT SUMMARIZE - Include all details provided
3. DO NOT OMIT any mentioned treatments, medications, or management plans
4. Document everything comprehensively and thoroughly
5. NEVER fabricate or assume information not present in the clinical content

MEDICAL DOCUMENTATION STANDARDS:
1. Use professional medical terminology
2. Be comprehensive in documenting - include ALL details
3. Add appropriate and relevant additions for better documentation
4. Detect and customize document according to attending practitioner
5. Use structured data where appropriate
6. Strictly Use International Classification of Diseases i.e ICD 10 or ICD 11 for all diagnoses
7. Detect treatment prescribed and separate from management plan treatments
8. Do not omit treatment plans e.g Paracet 1g iv stat. Strictly document ALL treatments
9. Strictly Document Review of Systems appropriately
10. Clearly separate out-patient prescription and in-patient prescription (e.g ceftriaxone 250mg iv stat)
11. In-patient prescription must be under treatmentPlan i.e management plan
12. Do not omit any mentioned in-patient treatment and management plan

PRESCRIPTION FORMATTING RULES:
- Route values (exact only): PO, IV, IM, SC, Top, INH
- Frequency values (exact only): OD, BD, TDS, QDS, Q4H, Q6H, Q8H, Q12H, PRN
- For in-patient orders: Include route (IV/IM/SC) and timing (STAT/scheduled)
- Omit prescription section entirely if no outpatient medications mentioned

CRITICAL OUTPUT REQUIREMENTS:
- Return ONLY valid JSON without any Markdown formatting
- DO NOT use code blocks (no \`\`\`json or \`\`\`)
- DO NOT add any text outside the JSON object
- Follow the exact structure provided
- OMIT fields that are not provided (do not use null or empty strings for optional fields)
- Start with { and end with }
- The response must be parseable by JSON.parse()
- Include ALL information from the clinical content without summarization`;

    const noteTypeTemplates: Record<CareNoteType, string> = {
      [CareNoteType.ADMISSION]: `
Generate an ADMISSION NOTE in JSON format with this structure:

FIELD INCLUSION RULES:
- REQUIRED fields: type, title, admissionReason, historyOfPresentIllness, assessment.diagnosis, assessment.treatmentPlan
- OPTIONAL fields (omit if not mentioned): pastMedicalHistory, allergies, medications, reviewOfSystems, physicalExam sections, assessment.differentialDiagnosis, assessment.prescription

{
  "type": "admission",
  "title": "Admission Note",
  "admissionReason": "string describing reason for admission",
  "historyOfPresentIllness": "detailed HPI - include ALL details provided",
  "pastMedicalHistory": "relevant PMH - only if mentioned",
  "allergies": "listed allergies - only if mentioned",
  "medications": "current medications - only if mentioned",
  "reviewOfSystems": {
    "sections": [
      {
        "id": "section1",
        "label": "Constitutional",
        "items": [
          {
            "id": "item1",
            "label": "Fever",
            "checked": true/false,
            "positive": true/false,
            "notes": "if any"
          }
        ]
      }
    ],
    "additionalNotes": "only if provided",
    "reviewedAndNegative": true/false
  },
  "physicalExam": {
    "generalAppearance": "only if examined",
    "musculoskeletal": "only if examined",
    "neurological": "only if examined"
  },
  "assessment": {
    "diagnosis": "primary diagnosis with ICD-10 or ICD-11 code",
    "differentialDiagnosis": ["only if mentioned"],
    "treatmentPlan": "treatment plan description and in-patient management plan (e.g CEFTRIAXONE 500MG IV STAT) - include ALL in-patient orders",
    "prescription": [
      {
        "medicine": "med name",
        "dose": "dose",
        "route": "PO/IV/IM/SC/Top/INH",
        "frequency": "OD/BD/TDS/QDS/Q4H/Q6H/Q8H/Q12H/PRN",
        "days": "number of days"
      }
    ]
  }
}

NOTE: Only include prescription array if outpatient medications are mentioned. Omit if empty.`,

      [CareNoteType.CONSULTATION]: `
Generate a CONSULTATION NOTE in JSON format with this structure:

FIELD INCLUSION RULES:
- REQUIRED fields: type, title, chiefComplaint.primary, historyOfPresentIllness, assessment.diagnosis
- OPTIONAL fields (omit if not mentioned): chiefComplaint.duration, chiefComplaint.description, reviewOfSystems, physicalExam, assessment.differentialDiagnosis, assessment.treatmentPlan, assessment.prescription

{
  "type": "consultation",
  "title": "Consultation Note",
  "chiefComplaint": {
    "primary": "main complaint",
    "duration": "only if mentioned",
    "description": "only if provided"
  },
  "historyOfPresentIllness": "detailed HPI - include ALL details provided",
  "reviewOfSystems": {
    "sections": [
      {
        "id": "section1",
        "label": "Constitutional",
        "items": [
          {
            "id": "item1",
            "label": "Fever",
            "checked": true/false,
            "positive": true/false,
            "notes": "if any"
          }
        ]
      }
    ],
    "additionalNotes": "only if provided",
    "reviewedAndNegative": true/false
  },
  "physicalExam": {
    "generalAppearance": "only if examined",
    "musculoskeletal": "only if examined",
    "neurological": "only if examined"
  },
  "assessment": {
    "diagnosis": "primary diagnosis with ICD-10 or ICD-11 code",
    "differentialDiagnosis": ["only if mentioned"],
    "treatmentPlan": "only if treatment plan described - include in-patient orders",
    "prescription": [
      {
        "medicine": "med name",
        "dose": "dose",
        "route": "PO/IV/IM/SC/Top/INH",
        "frequency": "OD/BD/TDS/QDS/Q4H/Q6H/Q8H/Q12H/PRN",
        "days": "number of days"
      }
    ]
  }
}

NOTE: Only include prescription array if outpatient medications are mentioned. Omit if empty.`,

      [CareNoteType.GENERAL_EXAMINATION]: `
Generate a GENERAL EXAMINATION NOTE in JSON format with this structure:

CRITICAL FIELD INCLUSION RULES:
- REQUIRED fields: type, title, history, examination.caseExamination, diagnosis, managementPlan
- OPTIONAL fields (omit entirely if not mentioned):
  * drugAllergies array
  * medication array
  * examination vital signs (bloodPressure, heartRate, temperature, gcs, respiratoryRate, oxygenSaturation, bloodGlucose, weight, height)
  * investigations
  * treatmentPrescriptions object and its items array
  * procedures array
  * admittedTo
  * additionalNotes
  * requestDoctor

{
  "type": "general_examination",
  "title": "General Examination Note",
  "drugAllergies": [
    {
      "substance": "allergen name",
      "reaction": "description of reaction",
      "severity": "mild/moderate/severe/life_threatening"
    }
  ],
  "medication": [
    {
      "medicine": "current medication name",
      "dose": "dose",
      "route": "PO/IV/IM/SC/Top/INH",
      "frequency": "OD/BD/TDS/QDS/Q4H/Q6H/Q8H/Q12H/PRN",
      "days": "duration"
    }
  ],
  "history": "patient history - include ALL details provided",
  "examination": {
    "bloodPressure": "systolic/diastolic mmHg (only if measured)",
    "heartRate": "bpm (only if measured)",
    "temperature": "°C or °F (only if measured)",
    "gcs": "Glasgow Coma Scale score (only if assessed)",
    "respiratoryRate": "breaths per minute (only if measured)",
    "oxygenSaturation": "SpO2 % (only if measured)",
    "bloodGlucose": "mg/dL or mmol/L (only if measured)",
    "weight": "kg (only if measured)",
    "height": "cm (only if measured)",
    "caseExamination": "detailed examination findings - include ALL findings and details"
  },
  "investigations": "lab results, imaging, tests ordered - include ALL details (only if investigations mentioned)",
  "diagnosis": "primary diagnosis with ICD-10 or ICD-11 code",
  "managementPlan": "comprehensive management plan including in-patient treatment (IV/IM/SC orders), follow-up, patient education - include ALL details",
  "treatmentPrescriptions": {
    "items": [
      {
        "medicine": "med name",
        "dose": "dose",
        "route": "PO/IV/IM/SC/Top/INH",
        "frequency": "OD/BD/TDS/QDS/Q4H/Q6H/Q8H/Q12H/PRN",
        "days": "number of days"
      }
    ],
    "additionalInstructions": "special instructions for patient (only if provided)"
  },
  "procedures": [
    {
      "name": "procedure name",
      "description": "procedure details"
    }
  ],
  "admittedTo": "ward/unit name (only if patient is actually admitted)",
  "additionalNotes": "any additional clinical notes or observations (only if provided)",
  "requestDoctor": "consulting/referring physician name (only if consultation requested)"
}

IMPORTANT OMISSION RULES:
1. Omit drugAllergies array entirely if no allergies mentioned
2. Omit medication array entirely if no current medications mentioned
3. Omit specific vital signs from examination object if not measured
4. Omit investigations field entirely if no tests mentioned
5. Omit treatmentPrescriptions object entirely if no outpatient prescriptions (mainly PO medications)
6. Omit procedures array entirely if no procedures performed
7. Omit admittedTo field entirely if patient not admitted
8. Omit requestDoctor field entirely if no consultation requested
9. Omit additionalNotes field entirely if no additional notes provided
10. In-patient treatments (IV/IM/SC/STAT orders) go in managementPlan, NOT in treatmentPrescriptions
11. Only outpatient prescriptions (primarily PO route) go in treatmentPrescriptions

CRITICAL STRUCTURE RULES — NEVER VIOLATE:
12. history, investigations, diagnosis, managementPlan, additionalNotes MUST be plain strings — NOT wrapped in objects. WRONG: "history": {"history": "..."} — CORRECT: "history": "..."
13. Do NOT add a "management" key — use "managementPlan" (plain string) only
14. Do NOT add an "additional" key — use "additionalNotes" (plain string) only
15. The JSON must contain ONLY the keys shown in the schema above — no extra wrapper objects`,

      [CareNoteType.PROCEDURE]: `
Generate a PROCEDURE NOTE in JSON format with this structure:

FIELD INCLUSION RULES:
- REQUIRED fields: type, title, procedureName, indications, description, findings
- OPTIONAL fields (omit if not mentioned): procedureCode, complications, postProcedureInstructions, anesthesiaUsed, estimatedBloodLoss, specimensTaken, durationMinutes, medicationsAdministered

{
  "type": "procedure",
  "title": "Procedure Note",
  "procedureName": "name of procedure",
  "procedureCode": "CPT code (only if known)",
  "indications": "reason for procedure - include ALL details",
  "description": "step-by-step description - include ALL steps",
  "findings": "what was found - include ALL findings",
  "complications": "any complications - only if occurred",
  "postProcedureInstructions": "instructions - only if provided",
  "anesthesiaUsed": "type of anesthesia (only if mentioned)",
  "estimatedBloodLoss": "amount (only if mentioned)",
  "specimensTaken": ["only if specimens taken"],
  "durationMinutes": 30,
  "medicationsAdministered": [
    {
      "name": "med name",
      "dosage": "dose",
      "route": "IV/IM/PO",
      "time": "time administered"
    }
  ]
}

NOTE: Omit optional arrays if empty.`,

      [CareNoteType.OPERATION]: `
Generate an OPERATION NOTE in JSON format with this structure:

FIELD INCLUSION RULES:
- REQUIRED fields: type, title, operationName, preoperativeDiagnosis, postoperativeDiagnosis, procedureDescription, findings
- OPTIONAL fields (omit if not mentioned): operationCode, specimens, estimatedBloodLoss, complications, anesthesiaType, surgicalTeam

{
  "type": "operation",
  "title": "Operation Note",
  "operationName": "name of operation",
  "operationCode": "code (only if known)",
  "preoperativeDiagnosis": "pre-op diagnosis with ICD-10 or ICD-11 code",
  "postoperativeDiagnosis": "post-op diagnosis with ICD-10 or ICD-11 code",
  "procedureDescription": "detailed description - include ALL steps and details",
  "findings": "intraoperative findings - include ALL findings",
  "specimens": ["only if specimens taken"],
  "estimatedBloodLoss": "amount (only if mentioned)",
  "complications": "any complications (only if occurred)",
  "anesthesiaType": "General/Regional/Local/Sedation (only if mentioned)",
  "surgicalTeam": [
    {
      "role": "Surgeon",
      "providerId": "id",
      "name": "Dr. Name"
    }
  ]
}

NOTE: Omit optional arrays and fields if not mentioned.`,

      [CareNoteType.ORTHOPEDIC_OPERATION]: `
Generate an ORTHOPEDIC OPERATION NOTE in JSON format with this structure:

FIELD INCLUSION RULES:
- REQUIRED fields: type, title, operationName, preoperativeDiagnosis, postoperativeDiagnosis, procedureDescription, findings, estimatedBloodLoss, complications
- OPTIONAL fields (omit if not mentioned): operationCode, laterality, approach, implants, boneGraft, tourniquet, reductionQuality, rangeOfMotion, antibioticRegimen, rehabProtocol, fluoroscopyShots, cArmTimeMinutes, specimens, surgicalTeam, anesthesiaType, anesthesiaDuration, drainsPlaced, closureTechnique

{
  "type": "orthopedic_operation",
  "title": "Orthopedic Operation Note",
  "operationName": "name of operation",
  "operationCode": "code (only if known)",
  "laterality": "Left/Right/Bilateral (only if mentioned)",
  "approach": "Anterior/Posterior/Lateral/Medial/Combined (only if mentioned)",
  "preoperativeDiagnosis": "pre-op diagnosis with ICD-10 or ICD-11 code",
  "postoperativeDiagnosis": "post-op diagnosis with ICD-10 or ICD-11 code",
  "procedureDescription": "detailed step-by-step description - include ALL steps and techniques",
  "findings": "intraoperative findings - include ALL findings",
  "specimens": ["specimen description (only if specimens taken)"],
  "estimatedBloodLoss": "amount in mL or description",
  "complications": "intraoperative complications or 'None'",
  "surgicalTeam": [
    {
      "role": "Surgeon/Assistant/Anesthesiologist/Nurse/Scrub Tech",
      "providerId": "id or unknown",
      "name": "Dr. Name (only if mentioned)"
    }
  ],
  "anesthesiaType": "General/Regional/Local/Sedation (only if mentioned)",
  "anesthesiaDuration": 90,
  "drainsPlaced": "drain description (only if placed)",
  "closureTechnique": "closure method (only if described)",
  "implants": [
    {
      "type": "Plate/Screw/Rod/Prosthesis/Cage/Anchor",
      "manufacturer": "manufacturer name (only if mentioned)",
      "model": "model number (only if mentioned)",
      "size": "size (only if mentioned)",
      "lotNumber": "lot number (only if mentioned)",
      "position": "anatomical position (only if mentioned)"
    }
  ],
  "boneGraft": {
    "type": "Autograft/Allograft/Synthetic",
    "source": "graft source (only if mentioned)",
    "volume": "amount used (only if mentioned)"
  },
  "tourniquet": {
    "used": true,
    "timeMinutes": 60,
    "pressureMmHg": 250
  },
  "reductionQuality": "Anatomical/Near-anatomical/Acceptable/Poor (only if assessed)",
  "rangeOfMotion": {
    "preOp": { "flexion": "value", "extension": "value" },
    "postOp": { "flexion": "value", "extension": "value" }
  },
  "antibioticRegimen": {
    "preoperative": "pre-op antibiotic given (only if mentioned)",
    "postoperative": "post-op antibiotic plan (only if mentioned)"
  },
  "rehabProtocol": {
    "weightBearing": "NWB/PWB/WBAT/FWB",
    "timeline": "rehab timeline description (only if mentioned)"
  },
  "fluoroscopyShots": 12,
  "cArmTimeMinutes": 8
}

ORTHOPEDIC NOTES:
- NWB=Non-weight-bearing, PWB=Partial weight-bearing, WBAT=Weight-bearing as tolerated, FWB=Full weight-bearing
- Always document laterality (Left/Right/Bilateral) when mentioned
- List ALL implants used with as much detail as available
- If tourniquet was used, document time and pressure; omit the tourniquet object entirely if not used
- rangeOfMotion keys should match the joint/movement documented (e.g. flexion, extension, abduction)
- Omit optional arrays and objects entirely if not mentioned.`,

      [CareNoteType.PROGRESS]: `
Generate a PROGRESS NOTE in JSON format with this structure:

FIELD INCLUSION RULES:
- REQUIRED fields: type, title, intervalHistory, assessmentAndPlan
- OPTIONAL fields (omit if not mentioned): physicalExam sections

{
  "type": "progress",
  "title": "Progress Note",
  "intervalHistory": "developments since last note - include ALL events",
  "physicalExam": {
    "generalAppearance": "description (only if examined)",
    "vitalSigns": {
      "bloodPressure": "value (only if measured)",
      "heartRate": "value (only if measured)",
      "respiratoryRate": "value (only if measured)",
      "temperature": "value (only if measured)"
    }
  },
  "assessmentAndPlan": [
    "Problem 1: assessment and plan - include ALL details",
    "Problem 2: assessment and plan - include ALL details"
  ]
}

NOTE: Omit physicalExam sections if not examined.`,

      [CareNoteType.DISCHARGE]: `
Generate a DISCHARGE NOTE in JSON format with this structure:

FIELD INCLUSION RULES:
- REQUIRED fields: type, title, dischargeDiagnosis, hospitalCourse, followUpPlan
- OPTIONAL fields (omit if not mentioned): dischargeMedications, dischargeInstructions

{
  "type": "discharge",
  "title": "Discharge Summary",
  "dischargeDiagnosis": "final diagnosis with ICD-10 or ICD-11 code",
  "hospitalCourse": "summary of hospital stay - include ALL key events",
  "dischargeMedications": ["only if medications prescribed"],
  "dischargeInstructions": "patient instructions (only if provided)",
  "followUpPlan": "follow-up arrangements - include ALL details"
}

NOTE: Omit optional arrays if empty.`,

      [CareNoteType.EMERGENCY]: `
Generate an EMERGENCY NOTE in JSON format with this structure:

FIELD INCLUSION RULES:
- REQUIRED fields: type, title, chiefComplaint.primary, historyOfPresentIllness, emergencyAssessment, emergencyPlan
- OPTIONAL fields (omit if not mentioned): chiefComplaint.duration, chiefComplaint.description, physicalExam sections, triage

{
  "type": "emergency",
  "title": "Emergency Department Note",
  "triage": {
    "level": "Critical/Urgent/Semi-urgent/Non-urgent (only if triage level mentioned)",
    "vitalSigns": {
      "bloodPressure": "value (only if measured)",
      "heartRate": "value (only if measured)",
      "respiratoryRate": "value (only if measured)",
      "temperature": "value (only if measured)",
      "oxygenSaturation": "SpO2 % (only if measured)",
      "gcs": "GCS score (only if assessed)"
    }
  },
  "chiefComplaint": {
    "primary": "main complaint",
    "duration": "duration of complaint (only if mentioned)",
    "description": "detailed description (only if provided)"
  },
  "historyOfPresentIllness": "HPI - include ALL details",
  "physicalExam": {
    "generalAppearance": "description (only if examined)",
    "cardiovascular": "findings (only if examined)",
    "respiratory": "findings (only if examined)",
    "abdomen": "findings (only if examined)",
    "neurological": "findings (only if examined)",
    "vitalSigns": {
      "bloodPressure": "value (only if measured)",
      "heartRate": "value (only if measured)",
      "respiratoryRate": "value (only if measured)",
      "temperature": "value (only if measured)"
    }
  },
  "emergencyAssessment": "ED assessment and diagnosis with ICD-10 or ICD-11 code - include ALL",
  "emergencyPlan": "ED plan and disposition - include ALL treatments, orders, and disposition"
}

TRIAGE LEVELS: Critical (life-threatening, immediate), Urgent (serious, <30min), Semi-urgent (stable, <60min), Non-urgent (minor, can wait)
NOTE: Omit triage object entirely if no triage level or arrival vitals are documented. Omit optional physicalExam sections if not examined.`,

      [CareNoteType.FOLLOW_UP]: `
Generate a FOLLOW-UP NOTE in JSON format with this structure:

FIELD INCLUSION RULES:
- REQUIRED fields: type, title, intervalHistory, assessmentAndPlan
- OPTIONAL fields (omit if not mentioned): physicalExam sections, complianceNotes

{
  "type": "follow_up",
  "title": "Follow-up Note",
  "intervalHistory": "developments since last visit, response to treatment, current symptoms - include ALL events",
  "physicalExam": {
    "generalAppearance": "description (only if examined)",
    "vitalSigns": {
      "bloodPressure": "value (only if measured)",
      "heartRate": "value (only if measured)",
      "temperature": "value (only if measured)",
      "weight": "value (only if measured)"
    },
    "relevantExamFindings": "focused examination relevant to the follow-up condition (only if examined)"
  },
  "complianceNotes": "medication adherence, lifestyle compliance, missed doses, side effects reported (only if discussed)",
  "assessmentAndPlan": [
    "Problem 1: current status and updated management plan - include ALL details",
    "Problem 2: current status and updated management plan - include ALL details"
  ]
}

NOTE: Omit physicalExam if not examined. Omit complianceNotes if compliance was not discussed.`,
      [CareNoteType.SOAP]: `
Generate a SOAP NOTE in JSON format with this structure:

{
  "type": "soap",
  "title": "SOAP Note",
  "subjective": "Patient's reported symptoms and history",
  "objective": "Physical exam findings and vitals",
  "assessment": "Diagnosis and clinical impression",
  "plan": "Treatment plan and next steps"
}`,
    };

    const template =
      noteTypeTemplates[noteType] ||
      noteTypeTemplates[CareNoteType.GENERAL_EXAMINATION];

    return `${medicalDocumentationStandards}\n\n${template}`;
  }

  /**
   * Build user prompt with content and context
   */
  private buildUserPrompt(options: {
    content: string;
    noteType: CareNoteType;
    template?: any;
  }): string {
    let prompt = `Based on this clinical content:\n\n"${options.content}"\n\n`;

    prompt += `Generate the note following the exact JSON structure specified in the system prompt.\n\n`;

    prompt += `CRITICAL REQUIREMENTS:
1. Include ALL information present in the clinical content
2. DO NOT SUMMARIZE - Document everything in full detail
3. DO NOT OMIT any treatments, medications, or management plans mentioned
4. ONLY include information that is explicitly present in the clinical content
5. NEVER add placeholder, dummy, or assumed data
6. If a field is not mentioned, OMIT it entirely from the JSON
7. Return ONLY the JSON object without any Markdown formatting
8. No code blocks, no additional text
9. The response must start with { and end with } and be valid JSON
10. Separate in-patient treatments (IV/IM/SC/STAT orders) under treatmentPlan or managementPlan
11. Separate out-patient prescriptions (primarily PO route) under prescription array
12. Include ALL details for comprehensive documentation
13. Empty arrays should be omitted entirely, not included as []
15. Management Plan must be in bullet or numbering for form
16. All investigations must be in investigations section.
`;

    return prompt;
  }

  /**
   * Comprehensive JSON extraction with multiple strategies
   */
  private extractJsonFromResponse(response: string): string {
    if (!response) return response;

    let cleaned = response.trim();

    // Strategy 1: Direct JSON parsing (if already valid JSON)
    if (this.isValidJson(cleaned)) {
      return cleaned;
    }

    // Strategy 2: Remove Markdown code blocks
    cleaned = this.removeMarkdownCodeBlocks(cleaned);

    if (this.isValidJson(cleaned)) {
      return cleaned;
    }

    // Strategy 3: Extract JSON between first { and last }
    cleaned = this.extractJsonUsingBraceMatching(cleaned);

    if (this.isValidJson(cleaned)) {
      return cleaned;
    }

    // Strategy 4: Remove common non-JSON prefixes and suffixes
    cleaned = this.removeCommonNonJsonWrappers(cleaned);

    if (this.isValidJson(cleaned)) {
      return cleaned;
    }

    // Strategy 5: Try to find JSON array if object not found
    cleaned = this.extractJsonArray(cleaned);

    if (this.isValidJson(cleaned)) {
      return cleaned;
    }

    // If all strategies fail, return the cleaned version for final attempt
    return cleaned;
  }

  /**
   * Remove Markdown code blocks and formatting
   */
  private removeMarkdownCodeBlocks(text: string): string {
    let cleaned = text.trim();

    // Remove ```json and ``` blocks
    cleaned = cleaned.replace(/^```json\s*/i, '');
    cleaned = cleaned.replace(/^```\s*/i, '');
    cleaned = cleaned.replace(/```$/g, '');

    // Remove multiple backticks at start and end
    cleaned = cleaned.replace(/^`+/, '');
    cleaned = cleaned.replace(/`+$/, '');

    return cleaned.trim();
  }

  /**
   * Extract JSON using brace matching
   */
  private extractJsonUsingBraceMatching(text: string): string {
    const firstBrace = text.indexOf('{');
    const firstBracket = text.indexOf('[');

    // Prefer object over array
    const startIndex = firstBrace !== -1 ? firstBrace : firstBracket;

    if (startIndex === -1) return text;

    let braceCount = 0;
    let bracketCount = 0;
    let inString = false;
    let escapeNext = false;
    let endIndex = -1;

    // Determine which type we're dealing with
    const isObject =
      firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket);
    const searchChar = isObject ? '{' : '[';
    const oppositeChar = isObject ? '}' : ']';

    for (let i = startIndex; i < text.length; i++) {
      const char = text[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === searchChar) {
          if (isObject) braceCount++;
          else bracketCount++;
        } else if (char === oppositeChar) {
          if (isObject) braceCount--;
          else bracketCount--;
        }

        const count = isObject ? braceCount : bracketCount;
        if (count === 0) {
          endIndex = i;
          break;
        }
      }
    }

    if (endIndex !== -1) {
      return text.substring(startIndex, endIndex + 1);
    }

    return text;
  }

  /**
   * Remove common non-JSON wrappers
   */
  private removeCommonNonJsonWrappers(text: string): string {
    let cleaned = text.trim();

    // Remove common prefixes
    const prefixes = [
      'Here is the JSON:',
      'JSON response:',
      'The note in JSON format:',
      'Generated JSON:',
      'Here is your JSON:',
      'Here is the consultation note in JSON format:',
      'Here is the generated note in JSON format:',
    ];

    prefixes.forEach((prefix) => {
      if (cleaned.toLowerCase().startsWith(prefix.toLowerCase())) {
        cleaned = cleaned.substring(prefix.length).trim();
      }
    });

    // Remove common suffixes
    const suffixes = [
      'This concludes the note.',
      'End of note.',
      'Note completed.',
      'JSON output complete.',
    ];

    suffixes.forEach((suffix) => {
      if (cleaned.toLowerCase().endsWith(suffix.toLowerCase())) {
        cleaned = cleaned.substring(0, cleaned.length - suffix.length).trim();
      }
    });

    return cleaned;
  }

  /**
   * Extract JSON array if no object found
   */
  private extractJsonArray(text: string): string {
    const firstBracket = text.indexOf('[');
    if (firstBracket === -1) return text;

    let bracketCount = 0;
    let inString = false;
    let escapeNext = false;
    let endIndex = -1;

    for (let i = firstBracket; i < text.length; i++) {
      const char = text[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '[') {
          bracketCount++;
        } else if (char === ']') {
          bracketCount--;
        }

        if (bracketCount === 0) {
          endIndex = i;
          break;
        }
      }
    }

    if (endIndex !== -1) {
      return text.substring(firstBracket, endIndex + 1);
    }

    return text;
  }

  /**
   * Fix common JSON issues before parsing
   */
  private fixCommonJsonIssues(text: string): string {
    let fixed = text.trim();

    // Remove trailing commas
    fixed = fixed.replace(/,\s*}/g, '}');
    fixed = fixed.replace(/,\s*]/g, ']');

    // Fix missing quotes around keys
    fixed = fixed.replace(
      /([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g,
      '$1"$2"$3',
    );

    // Fix single quotes to double quotes
    fixed = fixed.replace(/'/g, '"');

    // Remove comments (though JSON shouldn't have them)
    fixed = fixed.replace(/\/\/.*$/gm, '');
    fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, '');

    return fixed;
  }

  /**
   * Check if string is valid JSON
   */
  private isValidJson(text: string): boolean {
    if (!text || typeof text !== 'string') return false;

    const trimmed = text.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        JSON.parse(trimmed);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * Validate the structure of the parsed note
   */
  private validateNoteStructure(
    note: Record<string, any>,
    expectedType: CareNoteType,
  ): void {
    if (!note || typeof note !== 'object') {
      throw new Error('Parsed note is not a valid object');
    }

    // Basic validation - ensure type matches
    if (note.type && note.type !== expectedType) {
      this.logger.warn(
        `Note type mismatch: expected ${expectedType}, got ${note.type}`,
      );
    }

    // Ensure there's some content
    if (Object.keys(note).length === 0) {
      throw new Error('Parsed note is empty');
    }
  }

  /**
   * Normalize AI-generated note content to remove duplicates and unwrap
   * single-key objects that GPT sometimes produces despite prompt instructions.
   *
   * Known GPT hallucinations for general_examination:
   *   - Wraps plain string fields: history:{history:"..."} instead of history:"..."
   *   - Adds duplicate nested keys: management:{managementPlan:"..."} + managementPlan:"..."
   *   - Adds duplicate array:       treatmentPlan:[] alongside treatmentPrescriptions:{items:[]}
   *
   * Known GPT hallucinations for orthopedic_operation:
   *   - Wraps plain string fields: procedureDescription:{procedureDescription:"..."} instead of procedureDescription:"..."
   *   - Wraps findings, complications similarly
   *
   * Known GPT hallucinations for emergency:
   *   - Nests triage vitals under triage.vitals instead of triage.vitalSigns
   *   - Duplicates vital signs inside chiefComplaint
   */
  private normalizeNoteContent(
    note: Record<string, any>,
    noteType: CareNoteType,
  ): Record<string, any> {
    const result = { ...note };

    // ── Helper: unwrap single-key string object → plain string ───────────────
    const unwrapScalarFields = (obj: Record<string, any>, fields: string[]) => {
      for (const field of fields) {
        const val = obj[field];
        if (val !== null && val !== undefined && typeof val === 'object' && !Array.isArray(val)) {
          const keys = Object.keys(val);
          if (keys.length === 1 && typeof val[keys[0]] === 'string') {
            obj[field] = val[keys[0]];
          }
        }
      }
    };

    // ── Helper: lift nested key to top level and delete the wrapper ──────────
    const liftNestedKey = (
      obj: Record<string, any>,
      wrapperKey: string,
      innerKey: string,
      targetKey: string,
    ) => {
      if (obj[wrapperKey] && typeof obj[wrapperKey] === 'object') {
        if (!obj[targetKey] && obj[wrapperKey][innerKey]) {
          obj[targetKey] = obj[wrapperKey][innerKey];
        }
        delete obj[wrapperKey];
      }
    };

    // ── GENERAL_EXAMINATION ──────────────────────────────────────────────────
    if (noteType === CareNoteType.GENERAL_EXAMINATION) {
      unwrapScalarFields(result, [
        'history', 'investigations', 'diagnosis',
        'managementPlan', 'additionalNotes', 'admittedTo', 'requestDoctor',
      ]);

      // management:{managementPlan} duplicate wrapper
      liftNestedKey(result, 'management', 'managementPlan', 'managementPlan');
      // additional:{additionalNotes} duplicate wrapper
      liftNestedKey(result, 'additional', 'additionalNotes', 'additionalNotes');

      // treatmentPlan[] is left as-is — separate field from treatmentPrescriptions.
    }

    // ── ORTHOPEDIC_OPERATION ─────────────────────────────────────────────────
    if (noteType === CareNoteType.ORTHOPEDIC_OPERATION) {
      unwrapScalarFields(result, [
        'procedureDescription', 'findings', 'complications',
        'estimatedBloodLoss', 'preoperativeDiagnosis', 'postoperativeDiagnosis',
      ]);

      // Normalise tourniquet.used — GPT may emit string "true"/"false"
      if (result['tourniquet'] && typeof result['tourniquet'] === 'object') {
        const t = result['tourniquet'];
        if (typeof t.used === 'string') {
          t.used = t.used.toLowerCase() === 'true';
        }
        // If tourniquet was not used and has no useful data, remove it
        if (t.used === false && !t.timeMinutes && !t.pressureMmHg) {
          delete result['tourniquet'];
        }
      }

      // Normalise rehabProtocol.weightBearing — GPT sometimes uses full words
      if (result['rehabProtocol'] && typeof result['rehabProtocol'] === 'object') {
        const wb = result['rehabProtocol'].weightBearing as string;
        if (wb) {
          const wbMap: Record<string, string> = {
            'non-weight-bearing': 'NWB', 'non weight bearing': 'NWB', 'nwb': 'NWB',
            'partial': 'PWB', 'partial weight-bearing': 'PWB', 'pwb': 'PWB',
            'as tolerated': 'WBAT', 'weight-bearing as tolerated': 'WBAT', 'wbat': 'WBAT',
            'full': 'FWB', 'full weight-bearing': 'FWB', 'fwb': 'FWB',
          };
          result['rehabProtocol'].weightBearing = wbMap[wb.toLowerCase()] ?? wb;
        }
      }
    }

    // ── EMERGENCY ────────────────────────────────────────────────────────────
    if (noteType === CareNoteType.EMERGENCY) {
      // GPT sometimes uses triage.vitals instead of triage.vitalSigns
      if (result['triage'] && typeof result['triage'] === 'object') {
        if (result['triage']['vitals'] && !result['triage']['vitalSigns']) {
          result['triage']['vitalSigns'] = result['triage']['vitals'];
          delete result['triage']['vitals'];
        }
        // If triage object is effectively empty (no level, no vitalSigns), remove it
        if (!result['triage']['level'] && !result['triage']['vitalSigns']) {
          delete result['triage'];
        }
      }
    }

    return result;
  }

  /**
   * Validate and select appropriate model for text generation
   * Prevents using audio models for chat completion
   */
  private validateAndSelectModel(requestedModel?: string): string {
    // If no model specified, use default
    if (!requestedModel) {
      return this.defaultGenerationModel;
    }

    // If model is whisper-1 or any audio model, use default generation model
    if (requestedModel.includes('whisper')) {
      this.logger.warn(
        `Model ${requestedModel} is for audio transcription, using default ${this.defaultGenerationModel} for text generation`,
      );
      return this.defaultGenerationModel;
    }

    // Check if model is supported for chat completion
    const isSupported = this.supportedChatModels.some((supportedModel) =>
      requestedModel.toLowerCase().includes(supportedModel.toLowerCase()),
    );

    if (!isSupported) {
      this.logger.warn(
        `Model ${requestedModel} may not be supported for chat completion, attempting anyway`,
      );
    }

    return requestedModel;
  }

  /**
   * Normalize language code to ISO-639-1 format
   * Converts codes like 'en-US', 'en_US' to 'en'
   */
  private normalizeLanguageCode(language?: string): string | undefined {
    if (!language) return undefined;

    // Remove region codes and normalize
    const normalized = language.split(/[-_]/)[0].toLowerCase();

    // Common language code mappings
    const languageMappings: { [key: string]: string } = {
      en: 'en',
      es: 'es',
      fr: 'fr',
      de: 'de',
      it: 'it',
      pt: 'pt',
      ru: 'ru',
      zh: 'zh',
      ja: 'ja',
      ko: 'ko',
      ar: 'ar',
      hi: 'hi',
    };

    return languageMappings[normalized] || normalized;
  }

  private isOpenAIAPIError(error: unknown): error is OpenAIApiError {
    if (!error || typeof error !== 'object') return false;

    const apiError = error as OpenAIApiError;
    return (
      apiError.status !== undefined &&
      typeof apiError.status === 'number' &&
      apiError.message !== undefined &&
      typeof apiError.message === 'string'
    );
  }

  private mapTranscriptionError(error: OpenAIApiError): Error {
    const errorMap: { [key: number]: string } = {
      400: 'Invalid audio file format or corrupt file. Please check the file format and try again.',
      401: 'Authentication failed. Please check your OpenAI API key.',
      403: 'Access forbidden. Check your API plan and permissions.',
      429: 'Rate limit exceeded. Please wait and try again.',
      500: 'OpenAI server error. Please try again later.',
      503: 'OpenAI service temporarily unavailable.',
    };

    // Handle specific language format error
    if (
      error.message.includes('Invalid language') &&
      error.message.includes('ISO-639-1')
    ) {
      return new Error(
        'Invalid language format. Please use language codes like "en", "es", "fr" without region codes.',
      );
    }

    const message =
      errorMap[error.status || 0] || `OpenAI API error: ${error.message}`;
    return new Error(message);
  }

  private formatBytes(bytes: number): string {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Get supported models for different operations
   */
  getSupportedModels(operation: 'transcription' | 'generation'): string[] {
    if (operation === 'transcription') {
      return ['whisper-1'];
    }
    return this.supportedChatModels;
  }

  /**
   * Get the default model for generation
   */
  getDefaultGenerationModel(): string {
    return this.defaultGenerationModel;
  }

  /**
   * Get the AI provider type
   */
  getProvider(): AIProvider {
    return AIProvider.OPENAI;
  }
}
