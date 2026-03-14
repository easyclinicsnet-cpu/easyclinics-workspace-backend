import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { ActivityLogService } from './activity-log.service';
import { Request } from 'express';

interface LogEntry {
  userId: string;
  action: string;
  ipAddress: string;
  userAgent: string;
  metadata: Record<string, unknown>; // Using unknown instead of any for better type safety
  timestamp: Date;
}

interface AuthenticatedUser {
  id?: string;
  // Add other user properties as needed
}

@Injectable()
export class AuditGuard implements CanActivate {
  constructor(private readonly auditService: ActivityLogService) {}

  private getClientIp(request: Request): string {
    return request.ip
      || request.socket?.remoteAddress
      || request.connection?.remoteAddress
      || 'unknown';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as AuthenticatedUser;

    const logEntry: LogEntry = {
      userId: user?.id || 'anonymous',
      action: `${request.method} ${request.path}`,
      ipAddress: this.getClientIp(request),
      userAgent: request.headers['user-agent']?.toString() || 'unknown',
      metadata: {
        params: request.params,
        query: request.query,
      },
      timestamp: new Date(),
    };

    await this.auditService.log(logEntry);
    return true;
  }
}
