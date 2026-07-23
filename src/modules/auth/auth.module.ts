import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { EmailVerificationService } from './email-verification.service';
import { PasswordResetService } from './password-reset.service';
import { UsersModule } from '../users/users.module';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthConfig } from '../../config/configuration';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    // registerAsync (rather than a static register()) because the secret
    // and expiry come from ConfigService, which itself depends on
    // env validation having already run — this defers reading the config
    // until Nest's DI container actually resolves it, rather than at
    // module-definition time when ConfigService might not be ready yet.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const authConfig = configService.get<AuthConfig>('auth')!;
        return {
          secret: authConfig.jwtAccessSecret,
          signOptions: { expiresIn: authConfig.jwtAccessExpiresIn },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    GoogleStrategy,
    EmailVerificationService,
    PasswordResetService,
    // Registered here (not in AppModule) because it's conceptually part
    // of "what Auth provides" — but APP_GUARD makes Nest apply it
    // GLOBALLY across every controller in the app regardless of which
    // module declares it, since Nest treats APP_GUARD as request-scoped
    // global middleware once registered anywhere in the module graph.
    // This is what makes routes protected-by-default (see JwtAuthGuard's
    // own comment for the reasoning behind that choice).
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
