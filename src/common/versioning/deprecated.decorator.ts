import {
  applyDecorators,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UseInterceptors,
} from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * Creates an interceptor class (per factory call) that injects RFC 8594
 * deprecation headers into every HTTP response for the decorated route.
 *
 * The factory pattern captures `sunsetDate` in a closure so the interceptor
 * does not need constructor injection from the DI container.
 */
function makeDeprecationInterceptor(sunsetDate?: string): new () => NestInterceptor {
  @Injectable()
  class DeprecationInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
      return next.handle().pipe(
        tap(() => {
          const res = context.switchToHttp().getResponse<import('express').Response>();
          // RFC 8594 — Deprecation header
          res.setHeader('Deprecation', 'true');
          // Link header points to the migration guide / successor version
          res.setHeader(
            'Link',
            '<https://docs.easyclinics.com/api/migration>; rel="successor-version"',
          );
          if (sunsetDate) {
            // RFC 8594 — Sunset header (ISO 8601 date)
            res.setHeader('Sunset', sunsetDate);
          }
        }),
      );
    }
  }

  return DeprecationInterceptor;
}

/**
 * Marks a route (or controller) as deprecated.
 *
 * Effects:
 *  - Sets `Deprecation: true` response header (RFC 8594)
 *  - Sets `Link: ...; rel="successor-version"` response header
 *  - Optionally sets `Sunset: {date}` response header when a removal date is known
 *  - Adds corresponding `@ApiHeader` Swagger annotations so the headers appear
 *    in the generated OpenAPI spec
 *
 * @param sunsetDate — ISO 8601 date-time after which the endpoint will be removed
 *                     e.g. `'2026-12-31T23:59:59Z'`
 *
 * @example
 * // Controller-level: all routes deprecated
 * @Deprecated('2026-12-31T23:59:59Z')
 * @Controller({ path: 'appointments', version: 'v1' })
 * export class AppointmentsV1Controller { ... }
 *
 * // Method-level: single route deprecated
 * @Deprecated('2026-06-30T00:00:00Z')
 * @Get('legacy-search')
 * async legacySearch() { ... }
 */
export function Deprecated(sunsetDate?: string): MethodDecorator & ClassDecorator {
  const decorators: (MethodDecorator | ClassDecorator | PropertyDecorator)[] = [
    UseInterceptors(makeDeprecationInterceptor(sunsetDate)),
    ApiHeader({
      name: 'Deprecation',
      description:
        'Indicates this endpoint is deprecated. Clients should migrate to the successor version.',
      required: false,
      schema: { type: 'string', example: 'true' },
    }),
  ];

  if (sunsetDate) {
    decorators.push(
      ApiHeader({
        name: 'Sunset',
        description: `ISO 8601 date after which this endpoint will be permanently removed: ${sunsetDate}`,
        required: false,
        schema: { type: 'string', example: sunsetDate },
      }),
    );
  }

  return applyDecorators(...decorators);
}
