// Groups raw env vars into typed, namespaced config objects. Rather than
// injecting `ConfigService` and calling `configService.get('JWT_ACCESS_SECRET')`
// with a magic string scattered across every module that needs it, modules
// inject `configService.get<AuthConfig>('auth')` — one typed object, one
// place where the shape is defined, autocomplete works, and a typo in a
// key name is caught at compile time instead of returning `undefined` at
// runtime.

export interface AppConfig {
  port: number;
  nodeEnv: string;
  corsOrigin: string;
}

export interface DatabaseConfig {
  url: string;
}

export interface AuthConfig {
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  jwtAccessExpiresIn: string;
  jwtRefreshExpiresIn: string;
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
    jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackUrl: process.env.GOOGLE_CALLBACK_URL!,
    },
  } satisfies AuthConfig,
});
