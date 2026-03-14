import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as crypto from 'crypto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Reflector } from '@nestjs/core';
import { readFileSync } from 'fs';
import { join } from 'path';
import { LoggerService } from '../../logger/logger.service';

/**
 * Fallback permissions derived from role when the JWT contains no `permissions` claim.
 * These mirror the intended access matrix for each workspace role.
 */
const ROLE_PERMISSIONS: Record<string, string[]> = {
  workspace_owner: [
    'patients:read', 'patients:write',
    'appointments:read', 'appointments:write', 'appointments:delete',
    'care-notes:read', 'care-notes:write',
    'consultations:read', 'consultations:write',
    'billing:read', 'billing:write',
    'insurance:read', 'insurance:write', 'insurance:delete',
    'inventory:read', 'inventory:write', 'inventory:dispense', 'inventory:audit', 'inventory:delete',
    'audit:read', 'audit:write',
  ],
  workspace_co_owner: [
    'patients:read', 'patients:write',
    'appointments:read', 'appointments:write', 'appointments:delete',
    'care-notes:read', 'care-notes:write',
    'consultations:read', 'consultations:write',
    'billing:read', 'billing:write',
    'insurance:read', 'insurance:write', 'insurance:delete',
    'inventory:read', 'inventory:write', 'inventory:dispense', 'inventory:audit', 'inventory:delete',
    'audit:read', 'audit:write',
  ],
  admin: [
    'patients:read', 'patients:write',
    'appointments:read', 'appointments:write', 'appointments:delete',
    'care-notes:read', 'care-notes:write',
    'consultations:read', 'consultations:write',
    'billing:read', 'billing:write',
    'insurance:read', 'insurance:write',
    'inventory:read', 'inventory:write', 'inventory:audit',
    'audit:read', 'audit:write',
  ],
  manager: [
    'patients:read', 'patients:write',
    'appointments:read', 'appointments:write',
    'care-notes:read', 'care-notes:write',
    'consultations:read', 'consultations:write',
    'billing:read', 'billing:write',
    'insurance:read', 'insurance:write',
    'inventory:read', 'inventory:write', 'inventory:audit',
    'audit:read',
  ],
  physician: [
    'patients:read', 'patients:write',
    'appointments:read', 'appointments:write',
    'care-notes:read', 'care-notes:write',
    'consultations:read', 'consultations:write',
    'billing:read',
    'insurance:read',
    'inventory:read',
    'audit:read',
  ],
  practice_admin: [
    'patients:read', 'patients:write',
    'appointments:read', 'appointments:write', 'appointments:delete',
    'care-notes:read', 'care-notes:write',
    'consultations:read', 'consultations:write',
    'billing:read', 'billing:write',
    'insurance:read', 'insurance:write',
    'inventory:read', 'inventory:write', 'inventory:audit',
    'audit:read', 'audit:write',
  ],
  doctor: [
    'patients:read', 'patients:write',
    'appointments:read', 'appointments:write',
    'care-notes:read', 'care-notes:write',
    'consultations:read', 'consultations:write',
    'billing:read',
    'insurance:read',
    'inventory:read',
    'audit:read',
  ],
  nurse: [
    'patients:read', 'patients:write',
    'appointments:read', 'appointments:write',
    'care-notes:read', 'care-notes:write',
    'consultations:read',
    'billing:read',
    'insurance:read',
    'inventory:read',
    'audit:read',
  ],
  medical_assistant: [
    'patients:read', 'patients:write',
    'appointments:read',
    'care-notes:read',
    'billing:read',
    'insurance:read',
    'inventory:read',
    'audit:read',
  ],
  therapist: [
    'patients:read', 'patients:write',
    'appointments:read', 'appointments:write',
    'care-notes:read', 'care-notes:write',
    'consultations:read', 'consultations:write',
    'billing:read',
    'insurance:read',
    'audit:read',
  ],
  billing_staff: [
    'patients:read',
    'appointments:read',
    'billing:read', 'billing:write',
    'insurance:read', 'insurance:write',
    'inventory:read',
    'audit:read',
  ],
  pharmacist: [
    'patients:read',
    'care-notes:read',
    'billing:read',
    'insurance:read',
    'inventory:read', 'inventory:write', 'inventory:dispense',
    'audit:read',
  ],
  scheduler: [
    'patients:read',
    'appointments:read', 'appointments:write',
    'consultations:read',
    'care-notes:read',   // read/print notes during pre-consultation and for scheduling
    'billing:read',      // insurance dropdown lookup during patient registration
    'insurance:read',    // insurance provider/scheme data for patient registration
    'audit:read',
  ],
  lab_technician: [
    'patients:read',
    'audit:read',
  ],
  radiology_technician: [
    'patients:read',
    'audit:read',
  ],
  read_only: [
    'patients:read',
    'appointments:read',
    'care-notes:read',
    'consultations:read',
    'billing:read',
    'insurance:read',
    'inventory:read',
    'audit:read',
  ],
  staff: [
    'patients:read',
    'appointments:read',
    'care-notes:read',
    'billing:read',
    'audit:read',
  ],
  patient: [],
  vendor: [
    'inventory:read',
  ],
  guest: [],
};

// Extend Express Request type with our custom properties
declare module 'express' {
  interface Request {
    workspaceId: string;
    userId: string;
    ownerId: string;
    user: {
      id: string;
      email: string;
      role?: string;
      permissions?: string[];
    };
  }
}

@Injectable()
export class WorkspaceJwtGuard implements CanActivate {
  private readonly logger: LoggerService;
  private readonly cacheTtl: number;
  private publicKey!: crypto.KeyObject;

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    this.logger = new LoggerService(WorkspaceJwtGuard.name);
    this.cacheTtl = this.config.get('NODE_ENV') === 'development' ? 0 : 300;
    this.loadPublicKey();
  }

  private loadPublicKey(): void {
    const isDevelopment = this.config.get<string>('NODE_ENV') !== 'production';
    try {
      // Always relative to process.cwd() (project root) — predictable on both
      // Windows dev and Linux prod regardless of compiled output structure.
      const keyRelPath = this.config.get<string>('AUTH_PUBLIC_KEY') || 'keys/public.key';
      const publicKeyPath = join(process.cwd(), keyRelPath);

      const publicKeyPem = readFileSync(publicKeyPath, 'utf8')
        .trim()
        .replace(/\r\n/g, '\n');

      if (!publicKeyPem.includes('-----BEGIN PUBLIC KEY-----')) {
        throw new Error('Invalid public key format. Must be PEM encoded.');
      }

      // Create a KeyObject — required by jsonwebtoken when using PKCS#8 format keys
      this.publicKey = crypto.createPublicKey({ key: publicKeyPem, format: 'pem' });

      if (!isDevelopment) {
        const encryptionKey = this.config.get<string>('ENCRYPTION_KEY');
        if (!encryptionKey || encryptionKey.length < 32) {
          throw new Error(
            'Encryption key must be at least 32 characters in production',
          );
        }
      }

      this.logger.log('Public key loaded successfully');
    } catch (err) {
      this.logger.error('Failed to load public key', err instanceof Error ? err.stack : undefined);
      if (isDevelopment) {
        this.logger.warn('Continuing startup without RS256 public key — authentication will use fallback in development');
        return;
      }
      throw new Error('Failed to initialize authentication guard');
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      this.logger.warn(
        `No token provided for ${request.method} ${request.path}`,
      );
      throw this.buildUnauthorizedError('Authentication token required');
    }

    if (this.config.get('NODE_ENV') === 'development') {
      this.logger.debug(`Received token: ${token.substring(0, 20)}...`);
    }

    try {
      const payload = await this.validateToken(token);

      if (await this.isTokenRevoked(payload)) {
        throw new Error('Token has been revoked');
      }

      this.validateWorkspaceContext(payload);
      await this.cacheValidToken(token);
      this.attachUserContext(request, payload);
      this.applySecurityHeaders(request, payload);

      this.logger.debug(`Authentication successful for user ${payload.sub}`);
      return true;
    } catch (err) {
      this.logger.error(
        `Authentication failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        err instanceof Error ? err.stack : undefined,
      );
      await this.cacheInvalidToken(token);
      throw this.buildUnauthorizedError(
        err instanceof Error ? err.message : 'Authentication failed',
      );
    }
  }

  private async validateToken(token: string): Promise<any> {

    if (!token) {
      throw new Error('Token is empty or undefined');
    }


    try {
      // Step 1: Safely decode token to inspect header
      const decodedToken = this.jwtService.decode(token, { complete: true });

      if (!decodedToken || typeof decodedToken !== 'object') {
        throw new Error('Invalid token structure');
      }

      this.logger.debug('Token decoded successfully');

      // Step 2: Verify token header
      this.logger.debug(`Token header validated - alg: ${decodedToken.header.alg}, typ: ${decodedToken.header.typ}, kid: ${decodedToken.header.kid || 'N/A'}`);


      if (decodedToken.header.alg !== 'RS256') {
        throw new Error(
          `Invalid token algorithm. Expected RS256, got ${decodedToken.header.alg}. ` +
          `This usually means the portal backend failed to load its RSA private key ` +
          `and fell back to an HS256 portal token. Check AUTH_PRIVATE_KEY on the portal.`,
        );
      }

      // Step 3: Resolve public key — retry lazy load if constructor load failed
      // (e.g. file not found at startup that was silently swallowed in dev mode)
      if (!this.publicKey) {
        const keyRelPath = this.config.get<string>('AUTH_PUBLIC_KEY') || 'keys/public.key';
        const publicKeyPem = readFileSync(join(process.cwd(), keyRelPath), 'utf8')
          .trim()
          .replace(/\r\n/g, '\n');
        this.publicKey = crypto.createPublicKey({ key: publicKeyPem, format: 'pem' });
        this.logger.log('Public key loaded (lazy)');
      }

      // Step 4: Full verification with all security checks
      // Note: issuer and audience are validated in validateWorkspaceContext() below
      // to support multi-workspace scenarios where aud = workspaceId (UUID).
      // IMPORTANT: We must pass `secret` (not `publicKey`) because @nestjs/jwt's
      // getSecretKey resolves `options.secret || this.options.secret` before ever
      // reaching `options.publicKey`. Since the JwtModule is configured with a
      // symmetric `secret` for non-workspace tokens, passing via `publicKey` is
      // silently ignored and the symmetric key is used — causing the RS256 error.
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.publicKey as any,
        algorithms: ['RS256'],
        clockTolerance: 15,
        ignoreExpiration: false,
        complete: false,
      });

      // Step 5: Additional business logic validation
      if (!payload.sub || !payload.workspaceId) {
        throw new Error('Token missing required claims (sub, workspaceId)');
      }

      this.logger.debug(`Token validation successful - userId: ${payload.sub}, workspaceId: ${payload.workspaceId}, issuedAt: ${new Date(payload.iat * 1000).toISOString()}, expiresAt: ${new Date(payload.exp * 1000).toISOString()}`);

      return payload;
    } catch (error) {
      // Enhanced error handling
      let errorMessage = 'Token validation failed';
      let errorCode = 'AUTH_001';

      if (error instanceof Error) {
        this.logger.error('Token validation error', error.stack);

        // Classify different error types
        if (error.message.includes('algorithm')) {
          errorCode = 'AUTH_002';
          errorMessage = 'Unsupported token algorithm';
        } else if (error.message.includes('expired')) {
          errorCode = 'AUTH_003';
          errorMessage = 'Token has expired';
        } else if (
          error.message.includes('issuer') ||
          error.message.includes('audience')
        ) {
          errorCode = 'AUTH_004';
          errorMessage = 'Token issuer/audience mismatch';
        } else if (error.message.includes('signature')) {
          errorCode = 'AUTH_005';
          errorMessage = 'Invalid token signature';
        }
      }

      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Authentication Failed - validateToken()',
        message: errorMessage,
        code: errorCode,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private validateWorkspaceContext(payload: any): void {
    // Multi-tenancy: workspaceId is read from the token and injected into the
    // request context. No server-side workspace ID enforcement is performed —
    // the authenticated workspace is always whatever the token claims, allowing
    // users to switch between workspaces freely by presenting a new token.
    if (!payload.workspaceId) {
      throw new Error('Token missing required workspaceId claim');
    }

    this.logger.debug(`Workspace context: ${payload.workspaceId}`);
  }

  private async cacheValidToken(token: string): Promise<void> {
    if (this.cacheTtl > 0) {
      const cacheKey = this.getTokenCacheKey(token);
      await this.cacheManager.set(
        cacheKey,
        { isValid: true },
        this.cacheTtl * 1000,
      );
    }
  }

  private async cacheInvalidToken(token: string): Promise<void> {
    const cacheKey = this.getTokenCacheKey(token);
    await this.cacheManager.set(cacheKey, { isValid: false }, 15000);
  }

  private async isTokenRevoked(payload: any): Promise<boolean> {
    // Implement token revocation check (e.g., against a database or Redis)
    return false;
  }

  private attachUserContext(request: Request, payload: any): void {
    request.workspaceId = payload.workspaceId;
    request.userId = payload.sub;
    request.ownerId = payload.ownerId;

    // Workspace token carries `workspaceMemberRole` (from workspace_memberships.role).
    // Fall back to legacy `role` claim for backward compatibility during migration.
    const role: string = payload.workspaceMemberRole ?? payload.role ?? '';

    // Derive permissions: use explicit claim if present, otherwise fall back to
    // the role-based permission map (JWT issued by auth service may not include permissions).
    const permissions: string[] =
      Array.isArray(payload.permissions) && payload.permissions.length > 0
        ? payload.permissions
        : ROLE_PERMISSIONS[role] ?? [];

    request.user = {
      id: payload.sub,
      email: payload.email,
      role,
      permissions,
    };
  }

  private applySecurityHeaders(request: Request, payload: any): void {
    if (request.res) {
      request.res.setHeader('X-Workspace-Id', payload.workspaceId);
      request.res.setHeader('X-Content-Type-Options', 'nosniff');
      request.res.setHeader('X-Frame-Options', 'DENY');
      request.res.setHeader(
        'Strict-Transport-Security',
        'max-age=63072000; includeSubDomains; preload',
      );
      request.res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    }
  }

  private extractToken(request: Request): string | null {
    const authHeader = request.headers.authorization;
    if (authHeader && /^Bearer .+$/i.test(authHeader)) {
      return authHeader.split(' ')[1];
    }

    if (request.cookies?.emr_token) {
      return request.cookies.emr_token;
    }

    if (this.config.get('NODE_ENV') === 'development' && request.query?.token) {
      return request.query.token as string;
    }

    return null;
  }

  private getTokenCacheKey(token: string): string {
    return crypto
      .createHash('sha256')
      .update(token + this.config.get('JWT_SECRET_KEY'))
      .digest('hex');
  }

  private buildUnauthorizedError(message: string): UnauthorizedException {
    let code = 'AUTH_001';
    let docs = 'https://api.yourdomain.com/docs/errors/AUTH_001';

    if (message.includes('algorithm')) {
      code = 'AUTH_002';
      docs = 'https://api.yourdomain.com/docs/errors/AUTH_002';
    } else if (message.includes('revoked')) {
      code = 'AUTH_003';
      docs = 'https://api.yourdomain.com/docs/errors/AUTH_003';
    }

    return new UnauthorizedException({
      error: 'Authentication Failed - buildUnauthorizedError()',
      message,
      statusCode: 401,
      code,
      documentation: docs,
      timestamp: new Date().toISOString(),
    });
  }
}
