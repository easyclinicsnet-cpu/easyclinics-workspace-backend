import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../../logger/logger.service';

/**
 * Guard to enforce multi-tenancy workspace isolation.
 *
 * Features:
 * - Extracts workspace ID from multiple sources (JWT, headers, query params)
 * - Validates workspace ID against configuration
 * - Attaches workspace ID to request for downstream use
 * - Comprehensive logging for debugging and security auditing
 *
 * Multi-tenancy ensures that:
 * - Each workspace's data is isolated
 * - Requests cannot access other workspaces' data
 * - All database queries are scoped to the correct workspace
 *
 * @example
 * ```typescript
 * // In controller:
 * @UseGuards(TenantSchemaGuard)
 * @Controller('patients')
 * export class PatientsController {
 *   @Get()
 *   async findAll(@Req() request: Request) {
 *     // request.workspaceId is guaranteed to be set
 *     const workspaceId = request.workspaceId;
 *   }
 * }
 * ```
 */
@Injectable()
export class TenantSchemaGuard implements CanActivate {
  private readonly logger: LoggerService;

  constructor(private readonly configService: ConfigService) {
    this.logger = new LoggerService('TenantSchemaGuard');
  }

  /**
   * Validates workspace context for the incoming request.
   *
   * Validation Steps:
   * 1. Extract workspace ID from request (JWT, headers, or query params)
   * 2. Verify workspace ID is present
   * 3. Validate against expected workspace ID from configuration
   * 4. Attach validated workspace ID to request object
   *
   * @param context - Execution context containing request information
   * @returns True if workspace context is valid
   * @throws UnauthorizedException if workspace context is missing or invalid
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    this.logger.debug(
      `Validating workspace context for ${request.method} ${request.path}`,
    );

    // Extract workspace ID from multiple possible sources
    const workspaceId = this.extractTenantId(request);

    if (!workspaceId) {
      this.logger.warn(
        `Missing workspace ID in request`,
        JSON.stringify({
          method: request.method,
          path: request.path,
          headers: {
            'x-workspace-id': request.headers['x-workspace-id'] || 'not-present',
          },
          hasAuthToken: !!request.headers.authorization,
        }),
      );
      throw new UnauthorizedException('Workspace context required');
    }

    // Get expected workspace ID from configuration
    const expectedWorkspaceId = this.configService.get<string>('WORKSPACE_ID');

    // Validate workspace ID matches expected value
    if (workspaceId !== expectedWorkspaceId) {
      this.logger.error(
        'Workspace ID mismatch - potential security breach',
        JSON.stringify({
          expected: expectedWorkspaceId,
          received: workspaceId,
          path: request.path,
          method: request.method,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        }),
      );
      throw new UnauthorizedException('Invalid workspace context');
    }

    // Attach validated workspace ID to request for downstream use
    request.workspaceId = workspaceId;

    this.logger.debug(
      `Workspace context validated successfully: ${workspaceId}`,
    );

    return true;
  }

  /**
   * Extract tenant/workspace ID from multiple sources with priority order.
   *
   * Priority Order:
   * 1. Request object (from JWT auth middleware)
   * 2. X-Workspace-Id header
   * 3. Query parameter (development only)
   *
   * @param request - HTTP request object
   * @returns Workspace ID or null if not found
   */
  private extractTenantId(request: Request): string | null {
    // Priority 1: Check if JWT auth middleware already set workspace ID
    if (request.workspaceId) {
      this.logger.debug('Workspace ID found in request object (from JWT)');
      return request.workspaceId;
    }

    // Priority 2: Check X-Workspace-Id header
    const headerWorkspaceId = request.headers['x-workspace-id'];
    if (headerWorkspaceId) {
      const workspaceId = Array.isArray(headerWorkspaceId)
        ? headerWorkspaceId[0]
        : headerWorkspaceId;
      this.logger.debug('Workspace ID found in X-Workspace-Id header');
      return workspaceId;
    }

    // Priority 3: Check query parameters (development/testing only)
    const isDevelopment = this.configService.get('NODE_ENV') === 'development';
    if (isDevelopment && request.query?.workspaceId) {
      this.logger.debug(
        'Workspace ID found in query parameter (development mode)',
      );
      return request.query.workspaceId as string;
    }

    this.logger.warn('No workspace ID found in any source');
    return null;
  }
}

/**
 * Extend Express Request interface to include workspaceId
 */
declare global {
  namespace Express {
    interface Request {
      workspaceId?: string;
    }
  }
}
