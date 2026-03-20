import { AsyncLocalStorage } from 'async_hooks';

/**
 * Request-scoped context propagated via AsyncLocalStorage.
 *
 * Any code running within the same async call chain as an incoming HTTP
 * request can read the current request's IP address and User-Agent string
 * without needing the Express Request object passed as a parameter.
 *
 * Usage (in any service, no constructor injection required):
 *   const ip  = RequestContext.getIpAddress();
 *   const ua  = RequestContext.getUserAgent();
 */

export interface RequestContextStore {
  ipAddress: string;
  userAgent: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

export class RequestContext {
  /**
   * Run `fn` inside an async context bound to `store`.
   * Called by RequestContextMiddleware once per HTTP request.
   */
  static run<T>(store: RequestContextStore, fn: () => T): T {
    return storage.run(store, fn);
  }

  /** Returns the IP address of the current request, or '' if unavailable. */
  static getIpAddress(): string {
    return storage.getStore()?.ipAddress ?? '';
  }

  /** Returns the User-Agent header of the current request, or '' if unavailable. */
  static getUserAgent(): string {
    return storage.getStore()?.userAgent ?? '';
  }
}
