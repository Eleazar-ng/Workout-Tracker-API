import { z } from 'zod';

// Schema-first env validation: the shape, the validation rules, and the
// TypeScript type all come from ONE definition below — z.infer gives us
// the type for free, so there's no separate interface to keep in sync
// (unlike the class-validator version, where the class fields ARE the
// type, but you still needed a decorator per field to write the rule).
//
// Note: this is used ONLY for env validation. DTOs (request bodies)
// continue to use class-validator + class-transformer, since that pairs
// natively with @nestjs/swagger for OpenAPI generation in Stage 13 — see
// the delegation/architecture discussion for why we're deliberately using
// two validation approaches for two different jobs.
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  PORT: z.coerce.number().int().min(0).max(65535).default(3000),

  // Used to build links embedded in emails (verification, password reset)
  // — needs to be the externally-reachable URL of this API, which differs
  // from "localhost" once deployed.
  APP_BASE_URL: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Minimum 32 chars enforced the same way it was under class-validator —
  // avoids trivially weak secrets even in local/dev setups.
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z
  .string()
  .regex(
    /^\d+(s|m|h|d)$/,
    'JWT_ACCESS_EXPIRES_IN must look like "15m", "1h", "7d", etc.',
  )
  .default('15m'),
  JWT_REFRESH_EXPIRES_IN: z
  .string()
  .regex(
    /^\d+(s|m|h|d)$/,
    'JWT_REFRESH_EXPIRES_IN must look like "15m", "1h", "7d", etc.',
  )
  .default('7d'),

  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),
  GOOGLE_CALLBACK_URL: z.string().min(1, 'GOOGLE_CALLBACK_URL is required'),

  CORS_ORIGIN: z.string().default('*'),
});

export type EnvSchema = z.infer<typeof envSchema>;

// Called by @nestjs/config's ConfigModule.forRoot({ validate }) — see
// config.module.ts. Nest expects this function to either return the
// validated config object or throw. Zod's .safeParse() lets us catch the
// failure and rethrow a flattened, readable message so a misconfigured
// .env can be fixed in one pass rather than one error at a time — same
// fail-fast-at-boot behavior as before, just less code to get there.
export function validateEnv(config: Record<string, unknown>): EnvSchema {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Environment variable validation failed:\n${messages}`);
  }

  return result.data;
}
