import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { firstValueFrom } from 'rxjs';
import { LoggerService } from '../../../common/logger/logger.service';
import { AIProvider } from '../../../common/enums';

/**
 * AI operation types matching the portal backend's AiOperation enum.
 */
export enum AiOperation {
  TRANSCRIPTION = 'TRANSCRIPTION',
  NOTE_GENERATION = 'NOTE_GENERATION',
  LETTER_GENERATION = 'LETTER_GENERATION',
  CHAT_COMPLETION = 'CHAT_COMPLETION',
  EMBEDDING = 'EMBEDDING',
  STRUCTURED_TRANSCRIPT = 'STRUCTURED_TRANSCRIPT',
  IMAGE_ANALYSIS = 'IMAGE_ANALYSIS',
}

/**
 * AI usage status matching the portal backend's AiUsageStatus enum.
 */
export enum AiUsageStatus {
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/**
 * Maps EMR AIProvider enum values to portal AiProviderEnum values.
 */
const PROVIDER_MAP: Record<string, string> = {
  [AIProvider.OPENAI]: 'OPENAI',
  [AIProvider.ANTHROPIC]: 'ANTHROPIC',
  [AIProvider.GEMINI]: 'GEMINI',
  [AIProvider.AZURE_AI]: 'AZURE',
  [AIProvider.CUSTOM]: 'CUSTOM',
};

/**
 * Token usage data returned by AI strategy calls.
 */
export interface AiTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Payload sent to the portal backend POST /ai-usage/record endpoint.
 */
export interface ReportUsagePayload {
  userId: string;
  workspaceId: string;
  provider: AIProvider;
  model: string;
  operation: AiOperation;
  tokenUsage: AiTokenUsage;
  audioDurationSeconds?: number;
  responseTimeMs: number;
  status: AiUsageStatus;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

/**
 * AI Usage Reporting Service
 *
 * Reports each AI API call to the portal backend for billing,
 * credit deduction, and usage tracking. Calls are fire-and-forget
 * so AI operations are never blocked by billing failures.
 */
@Injectable()
export class AiUsageReportingService {
  private readonly portalBaseUrl: string;
  private readonly internalApiKey: string;
  private readonly timeout: number;
  private readonly enabled: boolean;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('AiUsageReportingService');

    this.portalBaseUrl = this.configService.get<string>(
      'PORTAL_API_BASE_URL',
      'http://localhost:3005/api/v1',
    );
    this.internalApiKey = this.configService.get<string>(
      'PORTAL_INTERNAL_API_KEY',
      '',
    );
    this.timeout = this.configService.get<number>(
      'PORTAL_API_TIMEOUT',
      10000,
    );
    this.enabled = !!this.internalApiKey;

    if (!this.enabled) {
      this.logger.warn(
        'AI usage reporting disabled — PORTAL_INTERNAL_API_KEY not configured',
      );
    } else {
      this.logger.log(
        `AI usage reporting enabled → ${this.portalBaseUrl}/ai-usage/record`,
      );
    }
  }

  /**
   * Report an AI usage event to the portal backend.
   * Fire-and-forget: logs errors but never throws so the AI operation itself is unaffected.
   */
  async reportUsage(payload: ReportUsagePayload): Promise<void> {
    if (!this.enabled) {
      this.logger.debug('Skipping usage report — reporting disabled');
      return;
    }

    const requestId = uuidv4();
    const portalProvider = PROVIDER_MAP[payload.provider] || 'CUSTOM';

    const body = {
      userId: payload.userId,
      workspaceId: payload.workspaceId,
      provider: portalProvider,
      model: payload.model,
      operation: payload.operation,
      inputTokens: payload.tokenUsage.inputTokens,
      outputTokens: payload.tokenUsage.outputTokens,
      audioDurationSeconds: payload.audioDurationSeconds,
      requestId,
      responseTimeMs: payload.responseTimeMs,
      status: payload.status,
      errorMessage: payload.errorMessage,
      metadata: payload.metadata,
    };

    try {
      const url = `${this.portalBaseUrl}/ai-usage/record`;

      this.logger.debug(`Reporting AI usage: ${payload.operation} via ${payload.provider}`, {
        requestId,
        model: payload.model,
        tokens: payload.tokenUsage.totalTokens,
      });

      await firstValueFrom(
        this.httpService.post(url, body, {
          headers: {
            'x-internal-api-key': this.internalApiKey,
            'Content-Type': 'application/json',
          },
          timeout: this.timeout,
        }),
      );

      this.logger.log(`Usage reported successfully`, {
        requestId,
        operation: payload.operation,
        provider: portalProvider,
        model: payload.model,
        totalTokens: payload.tokenUsage.totalTokens,
      });
    } catch (error: any) {
      // Fire-and-forget: never block the AI operation
      const status = error?.response?.status;
      const message = error?.response?.data?.message || error.message;

      this.logger.error(
        `Failed to report AI usage to portal: ${message}`,
        error.stack,
        {
          requestId,
          status,
          operation: payload.operation,
          provider: portalProvider,
        },
      );
    }
  }
}
