import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  const configService = app.get(ConfigService);
  const appConfig = configService.get<AppConfig>('app');

  // Required for req.cookies to be populated — AuthController reads the
  // refresh token from an httpOnly cookie (see cookie.constants.ts), and
  // without this middleware, req.cookies would be undefined on every
  // request.
  app.use(cookieParser());

  // Without this call, Nest does NOT listen for SIGTERM/SIGINT at all —
  // onModuleDestroy hooks (like PrismaService closing its DB connection)
  // would simply never run, and the process would be hard-killed by the
  // OS/orchestrator (e.g. Docker, Kubernetes) on every deploy or restart.
  // This is what makes our PrismaService's onModuleDestroy hook actually
  // fire in practice.
  app.enableShutdownHooks();

  // Global validation: every DTO across every module gets validated
  // automatically via class-validator decorators, with unknown properties
  // stripped rather than silently accepted (whitelist) and rejected
  // outright if present (forbidNonWhitelisted) — this closes off a class
  // of bugs/attacks where a client sends extra fields hoping one gets
  // persisted (e.g. trying to set { role: 'admin' } on a signup DTO).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: appConfig?.corsOrigin,
    // Required for the browser to send/receive the httpOnly refresh
    // cookie on cross-origin requests (e.g. a separate frontend origin in
    // dev/production). Without this, the cookie is silently dropped by
    // the browser regardless of the cookie's own attributes.
    //
    // IMPORTANT: per the CORS spec, `credentials: true` is INCOMPATIBLE
    // with a wildcard origin ("*") — browsers will reject it. Our
    // CORS_ORIGIN env var currently defaults to "*" for convenience with
    // tools like curl/Postman that ignore CORS entirely, but once a real
    // browser-based frontend is introduced, CORS_ORIGIN must be set to
    // that frontend's explicit origin (e.g. "http://localhost:5173").
    credentials: true,
  });

  const port = appConfig?.port ?? 3000;
  await app.listen(port);
  logger.log(`Application listening on port ${port}`);
}
bootstrap();
