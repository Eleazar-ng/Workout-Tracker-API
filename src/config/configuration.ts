// Groups raw env vars into typed, namespaced config objects. Rather than
// injecting `ConfigService` and calling `configService.get('JWT_ACCESS_SECRET')`
// with a magic string scattered across every module that needs it, modules
// inject `configService.get<AuthConfig>('auth')` — one typed object, one
// place where the shape is defined, autocomplete works, and a typo in a
// key name is caught at compile time instead of returning `undefined` at
// runtime.

import type { StringValue } from 'ms';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  corsOrigin: string;
  baseUrl: string;
  throttleTtlMs: number;
  throttleLimit: number;
}

export interface DatabaseConfig {
  url: string;
}

export interface AuthConfig {
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  // Typed as `ms`'s StringValue (e.g. "15m", "7d") rather than a plain
  // `string` — this is what @nestjs/jwt's SignOptions.expiresIn actually
  // expects. It's safe to type it this precisely (rather than casting at
  // every call site) because env.validation.ts enforces the matching
  // regex format (`^\d+(s|m|h|d)$`) at boot — by the time this config
  // object exists, the value is guaranteed to fit the shape.
  jwtAccessExpiresIn: StringValue;
  jwtRefreshExpiresIn: StringValue;
  google: {
    clientId: string;
    clientSecret: string;
    callbackUrl: string;
  };
}

export default () => ({
  app: {
    port: parseInt(process.env.PORT ?? '3000', 10),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    corsOrigin: process.env.CORS_ORIGIN ?? '*',
    baseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
    throttleTtlMs: parseInt(process.env.THROTTLE_TTL_MS ?? '60000', 10),
    throttleLimit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
  } satisfies AppConfig,

  database: {
    // Non-null assertion is safe here: validateEnv() (env.validation.ts)
    // already guarantees this is a defined, non-empty string before the
    // app finishes bootstrapping — if it were missing, boot would have
    // failed already with a clear validation error. TypeScript can't see
    // across that runtime guarantee, hence the assertion.
    url: process.env.DATABASE_URL!,
  } satisfies DatabaseConfig,

  auth: {
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET!,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET!,
    jwtAccessExpiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ??
      '15m') as StringValue,
    jwtRefreshExpiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ??
      '7d') as StringValue,
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackUrl: process.env.GOOGLE_CALLBACK_URL!,
    },
  } satisfies AuthConfig,
});
