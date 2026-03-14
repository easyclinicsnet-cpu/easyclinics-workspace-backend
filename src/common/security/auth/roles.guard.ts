import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { UserRole } from '../../enums';
import { ROLES_KEY } from './decorators';

/**
 * Guard that enforces role-based access control.
 *
 * Must be used AFTER WorkspaceJwtGuard (which attaches `req.user`).
 * If no @Roles() decorator is present on the route, access is allowed.
 *
 * @example
 * // Controller or method level
 * \@UseGuards(WorkspaceJwtGuard, RolesGuard)
 * \@Roles(UserRole.DOCTOR, UserRole.NURSE)
 * \@Get('notes')
 * getNotes() {}
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @Roles() decorator — route is open to any authenticated user
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const userRole = request.user?.role as UserRole | undefined;

    if (!userRole) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'User has no role assigned',
        code: 'AUTHZ_001',
        timestamp: new Date().toISOString(),
      });
    }

    const hasRole = requiredRoles.includes(userRole);

    if (!hasRole) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: `Role '${userRole}' is not authorized. Required: [${requiredRoles.join(', ')}]`,
        code: 'AUTHZ_002',
        timestamp: new Date().toISOString(),
      });
    }

    return true;
  }
}
