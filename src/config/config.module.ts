import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import configuration from './configuration';
import { validateEnv } from './env.validation';

@Module({
  imports: [
    NestConfigModule.forRoot({
      // Global so every feature module can inject ConfigService without
      // re-importing this module — config is read-only infrastructure,
      // not a domain concern, so this is one of the few modules that
      // should be global.
      isGlobal: true,
      // Load .env in dev/test; in production, real env vars injected by
      // the hosting platform take precedence automatically since
      // @nestjs/config only uses dotenv as a fallback for keys not
      // already present in process.env.
      envFilePath: '.env',
      load: [configuration],
      validate: validateEnv,
    }),
  ],
})
export class ConfigModule {}
