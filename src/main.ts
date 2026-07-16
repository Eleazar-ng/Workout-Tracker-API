import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  const configService = app.get(ConfigService);
  const appConfig = configService.get<AppConfig>('app');

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
  });

  const port = appConfig?.port ?? 3000;
  await app.listen(port);
  logger.log(`Application listening on port ${port}`);
}
bootstrap();
