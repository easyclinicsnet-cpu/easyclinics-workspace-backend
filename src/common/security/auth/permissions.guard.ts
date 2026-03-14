import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PERMISSIONS_KEY } from './decorators';

/**
 * Guard that enforces fine-grained permission-based access control.
 *
 * Must be used AFTER WorkspaceJwtGuard (which attaches `req.user.permissions`).
 * The user must possess ALL permissions listed in the @Permissions() decorator.
 * If no @Permissions() decorator is present, access is allowed.
 *
 * Permission strings follow the format "resource:action", e.g.:
 *   "patients:read", "patients:write", "billing:admin"
 *
 * @example
 * \@UseGuards(WorkspaceJwtGuard, PermissionsGuard)
 * \@Permissions('patients:write')
 * \@Post()
 * createPatient() {}
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @Permissions() decorator — route is open to any authenticated user
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const userPermissions: string[] = request.user?.permissions ?? [];

    const missing = requiredPermissions.filter(
      (p) => !userPermissions.includes(p),
    );

    if (missing.length > 0) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: `Missing required permission(s): [${missing.join(', ')}]`,
        code: 'AUTHZ_003',
        timestamp: new Date().toISOString(),
      });
    }

    return true;
  }
}
