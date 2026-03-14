import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AIProvider } from '../../../common/enums';
import { LoggerService } from '../../../common/logger/logger.service';
import { AiStrategyFactory } from '../strategies/ai-strategy.factory';

/**
 * Health Check Service
 * Scheduled monitoring of AI provider health status
 *
 * Exact business logic parity with legacy HealthCheckService:
 * - Tracks provider health status (OPENAI, ANTHROPIC, GEMINI)
 * - Runs scheduled health checks every 5 minutes
 * - Checks all providers on startup
 * - Exposes per-provider health status
 *
 * DDD Adaptations:
 * - Uses AiStrategyFactory instead of direct @Inject strategy tokens
 * - Uses Winston LoggerService instead of NestJS Logger
 * - Multi-tenant aware (workspace-agnostic — health checks are global)
 */
@Injectable()
export class HealthCheckService {
  private providerStatus: Record<string, boolean> = {
    [AIProvider.OPENAI]: true,
    [AIProvider.ANTHROPIC]: true,
    [AIProvider.GEMINI]: true,
  };

  constructor(
    private readonly aiStrategyFactory: AiStrategyFactory,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('HealthCheckService');
    // Check all providers on startup
    this.checkAllProviders();
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduledHealthCheck(): Promise<void> {
    this.logger.log('Running scheduled health check for AI providers');
    await this.checkAllProviders();
  }

  async checkAllProviders(): Promise<void> {
    await Promise.all([
      this.checkProviderHealth(AIProvider.OPENAI),
      // Uncomment when Anthropic/Gemini are actively used:
      // this.checkProviderHealth(AIProvider.ANTHROPIC),
      // this.checkProviderHealth(AIProvider.GEMINI),
    ]);
  }

  async checkProviderHealth(provider: AIProvider): Promise<boolean> {
    try {
      const strategy = this.aiStrategyFactory.getStrategy(provider);
      const healthStatus = await strategy.healthCheck();

      this.providerStatus[provider] = healthStatus.healthy;
      this.logger.log(
        `${provider} health status: ${healthStatus.healthy ? 'HEALTHY' : 'UNHEALTHY'}` +
          (healthStatus.details ? ` (${healthStatus.details})` : ''),
      );
      return healthStatus.healthy;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.providerStatus[provider] = false;
      this.logger.error(
        `Error checking health for ${provider}: ${errorMessage}`,
      );
      return false;
    }
  }

  getProviderStatus(provider: AIProvider): boolean {
    return this.providerStatus[provider] ?? false;
  }

  getAllProviderStatuses(): Record<string, boolean> {
    return { ...this.providerStatus };
  }
}
