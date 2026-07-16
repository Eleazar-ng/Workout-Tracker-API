import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from 'generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg'

// Extending PrismaClient (rather than just instantiating one somewhere and
// passing it around) lets us plug into Nest's DI and lifecycle hooks, and
// keeps every module's DB access going through a single injectable service
// with one connection pool.
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    super({
      adapter: new PrismaPg({connectionString}),
      errorFormat: 'pretty',
      // Query-level logging only in local/dev — kept out of the default
      // 'log' array here since it's driven by NODE_ENV inside onModuleInit
      // would require reading config, and Prisma's constructor runs before
      // Nest's DI is available. We keep this static and cheap; per-env
      // query logging can be revisited when we build structured logging.
      log: [
        { emit: 'stdout', level: 'error' },
        { emit: 'stdout', level: 'warn' },
      ],
    });
  }

  // Establish the DB connection explicitly at module init rather than
  // relying on Prisma's lazy-connect-on-first-query behavior. This way, if
  // the database is unreachable, the app fails to start immediately with a
  // clear error — not on the first user's request in production.
  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  // Nest calls onModuleDestroy during a graceful shutdown (SIGTERM/SIGINT),
  // but ONLY if app.enableShutdownHooks() was called in main.ts — see that
  // file. This ensures in-flight queries get a chance to finish and the
  // connection pool is closed cleanly, rather than the process being
  // killed mid-transaction.
  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database connection closed gracefully');
  }
}
