import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const { method, originalUrl } = request;
    const startTime = Date.now();

    // tap (not map) — this interceptor only observes the response to log
    // it, it never transforms the payload. Registration order in main.ts
    // doesn't matter here since this interceptor doesn't touch the body
    // either way.
    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          this.logger.log(
            `${method} ${originalUrl} ${response.statusCode} ${duration}ms`,
          );
        },
        error: (error: unknown) => {
          const duration = Date.now() - startTime;
          // Status code isn't reliably set on `response` yet at this
          // point for errors (the exception filter sets it afterward), so
          // we fall back to reading it off the error if present, else
          // mark unknown rather than misreport a 200.
          const statusCode =
            (error as { status?: number })?.status ?? 'ERROR';
          this.logger.log(
            `${method} ${originalUrl} ${statusCode} ${duration}ms`,
          );
        },
      }),
    );
  }
}
