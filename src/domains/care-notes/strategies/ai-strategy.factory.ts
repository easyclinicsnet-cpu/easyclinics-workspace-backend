import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIProvider } from '../../../common/enums';
import { LoggerService } from '../../../common/logger/logger.service';
import { IAiGenerationStrategy } from '../interfaces';
import { OpenAiStrategy } from './openai.strategy';
import { AnthropicStrategy } from './anthropic.strategy';
import { GeminiStrategy } from './gemini.strategy';

/**
 * AI Strategy Factory
 * Creates and manages AI provider strategies
 *
 * Features:
 * - Provider selection
 * - Automatic fallback to alternative providers
 * - Provider health monitoring
 * - Strategy caching
 *
 * Usage:
 * ```typescript
 * const strategy = this.aiStrategyFactory.getStrategy(AIProvider.OPENAI);
 * const result = await strategy.transcribeAudio(filePath);
 * ```
 */
@Injectable()
export class AiStrategyFactory {
  private strategies: Map<AIProvider, IAiGenerationStrategy> = new Map();
  private readonly defaultProvider: AIProvider;

  constructor(
    private readonly openAiStrategy: OpenAiStrategy,
    private readonly anthropicStrategy: AnthropicStrategy,
    private readonly geminiStrategy: GeminiStrategy,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('AiStrategyFactory');

    // Initialize strategies map
    this.strategies.set(AIProvider.OPENAI, this.openAiStrategy);
    this.strategies.set(AIProvider.ANTHROPIC, this.anthropicStrategy);
    this.strategies.set(AIProvider.GEMINI, this.geminiStrategy);

    // Get default provider from config or use OpenAI
    const configuredProvider = this.configService.get<string>('DEFAULT_AI_PROVIDER');
    this.defaultProvider = this.parseProvider(configuredProvider) || AIProvider.OPENAI;

    this.logger.log('AI Strategy Factory initialized', {
      defaultProvider: this.defaultProvider,
      availableProviders: Array.from(this.strategies.keys()),
    });
  }

  /**
   * Get strategy for specific provider
   * @param provider AI provider
   * @returns Strategy instance
   * @throws BadRequestException if provider not supported
   */
  getStrategy(provider?: AIProvider): IAiGenerationStrategy {
    const selectedProvider = provider || this.defaultProvider;

    const strategy = this.strategies.get(selectedProvider);

    if (!strategy) {
      throw new BadRequestException(
        `AI provider ${selectedProvider} is not supported`,
      );
    }

    return strategy;
  }

  /**
   * Get default strategy
   * @returns Default strategy instance
   */
  getDefaultStrategy(): IAiGenerationStrategy {
    return this.getStrategy(this.defaultProvider);
  }

  /**
   * Get strategy with automatic fallback
   * Tries primary provider, falls back to alternatives if unavailable
   *
   * @param primaryProvider Preferred provider
   * @param fallbackProviders Fallback providers in order of preference
   * @returns Strategy instance
   */
  async getStrategyWithFallback(
    primaryProvider?: AIProvider,
    fallbackProviders?: AIProvider[],
  ): Promise<{
    strategy: IAiGenerationStrategy;
    provider: AIProvider;
    isFallback: boolean;
  }> {
    const primary = primaryProvider || this.defaultProvider;
    const fallbacks = fallbackProviders || this.getDefaultFallbackChain(primary);

    // Try primary provider first
    const primaryStrategy = this.getStrategy(primary);
    const primaryHealth = await primaryStrategy.healthCheck();

    if (primaryHealth.healthy) {
      this.logger.debug('Using primary AI provider', { provider: primary });
      return {
        strategy: primaryStrategy,
        provider: primary,
        isFallback: false,
      };
    }

    this.logger.warn('Primary AI provider unhealthy, trying fallbacks', {
      primaryProvider: primary,
      healthDetails: primaryHealth.details,
      fallbackProviders: fallbacks,
    });

    // Try fallback providers
    for (const fallbackProvider of fallbacks) {
      try {
        const fallbackStrategy = this.getStrategy(fallbackProvider);
        const fallbackHealth = await fallbackStrategy.healthCheck();

        if (fallbackHealth.healthy) {
          this.logger.log('Using fallback AI provider', {
            provider: fallbackProvider,
            primaryProvider: primary,
          });

          return {
            strategy: fallbackStrategy,
            provider: fallbackProvider,
            isFallback: true,
          };
        }
      } catch (error) {
        this.logger.error(
          `Fallback provider ${fallbackProvider} failed`,
          error.stack,
        );
      }
    }

    throw new BadRequestException(
      `No healthy AI providers available. Primary: ${primary}, Fallbacks: ${fallbacks.join(', ')}`,
    );
  }

  /**
   * Get default fallback chain for a provider
   * @param primaryProvider Primary provider
   * @returns Array of fallback providers
   */
  private getDefaultFallbackChain(primaryProvider: AIProvider): AIProvider[] {
    const fallbackMap: Record<AIProvider, AIProvider[]> = {
      [AIProvider.OPENAI]: [AIProvider.ANTHROPIC, AIProvider.GEMINI],
      [AIProvider.ANTHROPIC]: [AIProvider.OPENAI, AIProvider.GEMINI],
      [AIProvider.GEMINI]: [AIProvider.OPENAI, AIProvider.ANTHROPIC],
      [AIProvider.AZURE_AI]: [AIProvider.OPENAI, AIProvider.ANTHROPIC],
      [AIProvider.CUSTOM]: [AIProvider.OPENAI, AIProvider.ANTHROPIC],
    };

    return fallbackMap[primaryProvider] || [];
  }

  /**
   * Check health of all providers
   * @returns Health status for each provider
   */
  async checkAllProvidersHealth(): Promise<
    Record<AIProvider, { healthy: boolean; details?: string; latency?: number }>
  > {
    const healthResults = {} as Record<
      AIProvider,
      { healthy: boolean; details?: string; latency?: number }
    >;

    for (const [provider, strategy] of this.strategies) {
      try {
        healthResults[provider] = await strategy.healthCheck();
      } catch (error) {
        healthResults[provider] = {
          healthy: false,
          details: this.extractErrorMessage(error),
        };
      }
    }

    return healthResults;
  }

  /**
   * Get all available providers
   * @returns Array of provider enums
   */
  getAvailableProviders(): AIProvider[] {
    return Array.from(this.strategies.keys());
  }

  /**
   * Parse provider string to enum
   * @param providerString Provider string
   * @returns Provider enum or undefined
   */
  private parseProvider(providerString?: string): AIProvider | undefined {
    if (!providerString) {
      return undefined;
    }

    const upperProvider = providerString.toUpperCase();

    if (Object.values(AIProvider).includes(upperProvider as AIProvider)) {
      return upperProvider as AIProvider;
    }

    return undefined;
  }

  /**
   * Extract error message from error object
   * @param error Error object
   * @returns Error message
   */
  private extractErrorMessage(error: any): string {
    if (typeof error === 'string') {
      return error;
    }

    return error?.message || JSON.stringify(error);
  }
}
