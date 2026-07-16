import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';

// AppModule is the root of the module tree. Infrastructure modules
// (ConfigModule, PrismaModule) are imported here since they're global.
// Every feature module we build (auth, exercises, programs, workouts,
// sets, analytics, social — under src/modules/) will be added to this
// imports array as each stage is completed.
@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
