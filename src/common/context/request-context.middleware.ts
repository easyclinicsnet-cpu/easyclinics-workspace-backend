import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { RequestContext } from './request-context';

/**
 * Populates the async-local RequestContext for every HTTP request.
 *
 * Extracts the real client IP address (honouring X-Forwarded-For when the
 * app runs behind a reverse proxy / load balancer) and the User-Agent header,
 * then stores them in RequestContext so that any service in the same async
 * call chain can read them without needing the Express Request object.
 *
 * Register globally in AppModule.configure().
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    // Honour X-Forwarded-For when behind a proxy/LB.
    // The header may be a comma-separated list; take the first entry.
    const forwarded = req.headers['x-forwarded-for'];
    const ipAddress: string = forwarded
      ? (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim()
      : req.ip ?? req.socket?.remoteAddress ?? '';

    const userAgent: string =
      (req.headers['user-agent'] as string | undefined) ?? '';

    RequestContext.run({ ipAddress, userAgent }, () => next());
  }
}
