import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from 'generated/prisma/client';
import type { Request, Response } from 'express';

interface ErrorResponseBody {
  error: {
    statusCode: number;
    message: string;
    errors?: string[]; // present only for validation failures
    timestamp: string;
    path: string;
    method: string;
    // Only ever populated outside production — see buildBody below.
    stack?: string;
  };
}

// @Catch() with no arguments — catches EVERYTHING, not just HttpException
// subclasses. This is deliberate: it's the app's last line of defense
// against leaking internal details (stack traces, raw driver error text,
// Prisma internals) to a client, for any error a service forgot to
// convert to a proper HttpException. Paired with
// TransformResponseInterceptor's { data: ... } success shape — a client
// can distinguish success/failure by which top-level key is present.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');
  private readonly isProduction: boolean;

  constructor(private readonly configService: ConfigService) {
    this.isProduction =
      this.configService.get<string>('app.nodeEnv') === 'production';
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, message, errors, logAsError } =
      this.resolveException(exception);

    if (logAsError) {
      // Full detail — including stack — always goes to the server log
      // regardless of environment. What differs by environment is only
      // what's returned to the CLIENT (see buildBody).
      this.logger.error(
        `${request.method} ${request.originalUrl} -> ${statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body = this.buildBody(
      statusCode,
      message,
      errors,
      request,
      exception,
    );

    response.status(statusCode).json(body);
  }

  private resolveException(exception: unknown): {
    statusCode: number;
    message: string;
    errors?: string[];
    logAsError: boolean;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      // ValidationPipe failures shape their response as
      // { statusCode, message: string[], error: 'Bad Request' } — message
      // is an ARRAY of per-field validation errors. Every other
      // HttpException's message is a plain string. Normalize both into
      // one consistent shape: a single summary `message`, plus an
      // `errors` array only when there's genuinely a list to show.
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'message' in payload &&
        Array.isArray((payload as { message: unknown }).message)
      ) {
        return {
          statusCode: status,
          message: 'Validation failed',
          errors: (payload as { message: string[] }).message,
          // 4xx from expected validation failures isn't a server-side
          // bug — don't spam error-level logs for normal bad input.
          logAsError: false,
        };
      }

      const message =
        typeof payload === 'string'
          ? payload
          : ((payload as { message?: string })?.message ?? exception.message);

      return {
        statusCode: status,
        message,
        // Only genuine server-side problems (5xx) get logged as errors;
        // expected 4xx client mistakes (404s, 409s the services already
        // throw deliberately) are normal traffic, not incidents.
        logAsError: status >= HttpStatus.INTERNAL_SERVER_ERROR,
      };
    }

    // Safety-net mapping for Prisma errors that slip through WITHOUT
    // having been explicitly caught and converted by a service (every
    // service we've built does its own P2002/P2003/P2025 handling
    // in-place, but this is a defensive fallback for anything missed —
    // present or future). Deliberately generic: we don't have per-error
    // context here to write a good message, so these produce a safe,
    // slightly vague client message while the FULL Prisma error (code,
    // meta, message) is always logged server-side via `logAsError: true`.
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Explicit cast rather than relying on instanceof's narrowing to
      // persist across statements — safe, since the instanceof check
      // above already verified this at runtime; this just makes the
      // static type match what we already know to be true.
      const prismaError = exception as Prisma.PrismaClientKnownRequestError;
      const map: Record<string, { status: number; message: string }> = {
        P2002: {
          status: HttpStatus.CONFLICT,
          message: 'A record with these details already exists',
        },
        P2003: {
          status: HttpStatus.CONFLICT,
          message: 'This action conflicts with related existing data',
        },
        P2025: {
          status: HttpStatus.NOT_FOUND,
          message: 'The requested record was not found',
        },
      };
      const mapped = map[prismaError.code];

      return {
        statusCode: mapped?.status ?? HttpStatus.INTERNAL_SERVER_ERROR,
        message: mapped?.message ?? 'An unexpected database error occurred',
        // Log it regardless — even the "mapped" cases indicate a service
        // method that should have handled this itself but didn't, which
        // is worth knowing about even though the client gets a clean
        // response either way.
        logAsError: true,
      };
    }

    // Anything else — a genuine unexpected bug. Never echo exception.message
    // to the client here; it could be anything (a raw driver error, a
    // null-reference message exposing internal variable/file names, etc.).
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      logAsError: true,
    };
  }

  private buildBody(
    statusCode: number,
    message: string,
    errors: string[] | undefined,
    request: Request,
    exception: unknown,
  ): ErrorResponseBody {
    const body: ErrorResponseBody = {
      error: {
        statusCode,
        message,
        ...(errors && { errors }),
        timestamp: new Date().toISOString(),
        path: request.originalUrl,
        method: request.method,
      },
    };

    // Stack traces are genuinely useful when developing locally, but are
    // an information-disclosure risk in production (file paths, internal
    // structure, dependency versions) — included only outside production,
    // and only for genuine Error instances.
    if (!this.isProduction && exception instanceof Error) {
      body.error.stack = exception.stack;
    }

    return body;
  }
}
