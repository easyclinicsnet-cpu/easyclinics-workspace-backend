import { Injectable, Optional, LoggerService as NestLoggerService } from '@nestjs/common';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

@Injectable()
export class LoggerService implements NestLoggerService {
  private logger: winston.Logger;
  private context?: string;

  constructor(@Optional() context?: string) {
    this.context = context;
    this.logger = this.createLogger();
  }

  /**
   * Create Winston logger instance
   */
  private createLogger(): winston.Logger {
    const isDevelopment = process.env.NODE_ENV !== 'production';

    return winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json(),
      ),
      defaultMeta: {
        service: 'easyclinics-emr-backend',
        environment: process.env.NODE_ENV || 'development',
      },
      transports: [
        // Console transport for development
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message, context, ...meta }) => {
              const ctx = context || this.context || 'Application';
              const metaString = Object.keys(meta).length
                ? `\n${JSON.stringify(meta, null, 2)}`
                : '';
              return `${timestamp} [${ctx}] ${level}: ${message}${metaString}`;
            }),
          ),
        }),

        // File transport for errors (with rotation)
        new DailyRotateFile({
          filename: 'logs/error-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          level: 'error',
          maxSize: '20m',
          maxFiles: '30d',
          format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
        }),

        // File transport for combined logs (with rotation)
        new DailyRotateFile({
          filename: 'logs/combined-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '14d',
          format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
        }),
      ],
    });
  }

  /**
   * Set context for all subsequent logs
   */
  setContext(context: string): void {
    this.context = context;
  }

  /**
   * Log a message at 'log' (info) level
   */
  log(message: string, contextOrData?: string | Record<string, any>): void {
    if (typeof contextOrData === 'object' && contextOrData !== null) {
      this.logger.info(message, { context: this.context, ...contextOrData });
    } else {
      this.logger.info(message, { context: contextOrData || this.context });
    }
  }

  /**
   * Log a message at 'info' level (alias for log)
   */
  info(message: string, contextOrData?: string | Record<string, any>): void {
    this.log(message, contextOrData);
  }

  /**
   * Log a message at 'error' level
   */
  error(message: string, traceOrData?: string | Record<string, any>, contextOrData?: string | Record<string, any>): void {
    const meta: Record<string, any> = { context: this.context };
    if (typeof traceOrData === 'string') {
      meta.trace = traceOrData;
    } else if (typeof traceOrData === 'object' && traceOrData !== null) {
      Object.assign(meta, traceOrData);
    }
    if (typeof contextOrData === 'string') {
      meta.context = contextOrData;
    } else if (typeof contextOrData === 'object' && contextOrData !== null) {
      Object.assign(meta, contextOrData);
    }
    this.logger.error(message, meta);
  }

  /**
   * Log a message at 'warn' level
   */
  warn(message: string, contextOrData?: string | Record<string, any>): void {
    if (typeof contextOrData === 'object' && contextOrData !== null) {
      this.logger.warn(message, { context: this.context, ...contextOrData });
    } else {
      this.logger.warn(message, { context: contextOrData || this.context });
    }
  }

  /**
   * Log a message at 'debug' level
   */
  debug(message: string, contextOrData?: string | Record<string, any>): void {
    if (typeof contextOrData === 'object' && contextOrData !== null) {
      this.logger.debug(message, { context: this.context, ...contextOrData });
    } else {
      this.logger.debug(message, { context: contextOrData || this.context });
    }
  }

  /**
   * Log a message at 'verbose' level
   */
  verbose(message: string, contextOrData?: string | Record<string, any>): void {
    if (typeof contextOrData === 'object' && contextOrData !== null) {
      this.logger.verbose(message, { context: this.context, ...contextOrData });
    } else {
      this.logger.verbose(message, { context: contextOrData || this.context });
    }
  }

  /**
   * Log structured data
   */
  logData(level: string, message: string, data?: Record<string, any>, context?: string): void {
    this.logger.log(level, message, {
      context: context || this.context,
      ...data,
    });
  }

  /**
   * Log HTTP request
   */
  logRequest(method: string, url: string, statusCode: number, responseTime: number): void {
    this.logger.info('HTTP Request', {
      context: 'HTTP',
      method,
      url,
      statusCode,
      responseTime: `${responseTime}ms`,
    });
  }

  /**
   * Log database query
   */
  logQuery(query: string, parameters?: any[], executionTime?: number): void {
    this.logger.debug('Database Query', {
      context: 'Database',
      query,
      parameters,
      executionTime: executionTime ? `${executionTime}ms` : undefined,
    });
  }

  /**
   * Log security event
   */
  logSecurityEvent(event: string, details: Record<string, any>): void {
    this.logger.warn('Security Event', {
      context: 'Security',
      event,
      ...details,
    });
  }

  /**
   * Log business event
   */
  logBusinessEvent(event: string, details: Record<string, any>): void {
    this.logger.info('Business Event', {
      context: 'Business',
      event,
      ...details,
    });
  }
}
