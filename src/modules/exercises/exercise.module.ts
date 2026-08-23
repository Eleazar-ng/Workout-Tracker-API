import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ExercisesController } from './exercises.controller';
import { ExercisesService } from './exercises.service';

@Module({
  imports: [
    CacheModule.register({
      // ttl is in MILLISECONDS as of cache-manager v5+ (this changed from
      // seconds in earlier major versions — worth flagging since it's an
      // easy silent-bug spot if someone upgrades/downgrades later).
      ttl: 5 * 60 * 1000, // 5 minutes
    }),
  ],
  controllers: [ExercisesController],
  providers: [ExercisesService],
})
export class ExercisesModule {}
