import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// @Global(): every domain module (Programs, Workouts, Sets, etc.) needs DB
// access, and re-importing PrismaModule in all ten of them would be pure
// boilerplate with no benefit — Prisma access is infrastructure, not a
// bounded domain concern, same reasoning as ConfigModule being global.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
