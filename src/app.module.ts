import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule as NestConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { ExercisesModule } from './modules/exercises/exercise.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { MailModule } from './modules/mail/mail.module';
import { ProgramsModule } from './modules/programs/programs.module';
import { WorkoutsModule } from './modules/workouts/workouts.module';
import { SetsModule } from './modules/sets/sets.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { SocialModule } from './modules/social/social.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from './common/interceptors/transform-response.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { AppConfig } from './config/configuration';

// AppModule is the root of the module tree. Infrastructure modules
// (ConfigModule, PrismaModule) are imported here since they're global.
// Every feature module we build (auth, exercises, programs, workouts,
// sets, analytics, social — under src/modules/) will be added to this
// imports array as each stage is completed.
//
// Cross-cutting providers (exception filter, response/logging
// interceptors, rate-limit guard) are registered here via APP_* tokens
// rather than in main.ts — this keeps them inside Nest's DI container
// (needed by AllExceptionsFilter, which injects ConfigService) rather
// than being manually instantiated with `app.useGlobalFilters(new Filter())`,
// which would bypass DI entirely.
@Module({
  imports: [
    ConfigModule, 
    PrismaModule,
    MailModule, 
    ExercisesModule,
    UsersModule,
    AuthModule,
    ProgramsModule,
    WorkoutsModule,
    SetsModule,
    AnalyticsModule,
    SocialModule,
    ThrottlerModule.forRootAsync({
      imports: [NestConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const appConfig = configService.get<AppConfig>('app')!;
        return [
          {
            ttl: appConfig.throttleTtlMs,
            limit: appConfig.throttleLimit,
          },
        ];
      },
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Order matters for interceptors: registration order here is the
    // order they wrap the request. LoggingInterceptor is listed second
    // so its timing log reflects the full round-trip including
    // TransformResponseInterceptor's work, though in practice both are
    // fast enough that this is more about correctness of intent than
    // measurable impact.
    { provide: APP_INTERCEPTOR, useClass: TransformResponseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Applies the ThrottlerModule config above to EVERY route by default.
    // AuthController overrides specific sensitive endpoints with a
    // stricter per-route @Throttle() decorator — see auth.controller.ts.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
