import { Module } from '@nestjs/common';
import { SetsController } from './sets.controller';
import { SetsService } from './sets.service';
import { WorkoutsModule } from '../workouts/workouts.module';

@Module({
  // WorkoutsModule exports WorkoutsService specifically so this import
  // works — see the comment in workouts.module.ts's exports array.
  imports: [WorkoutsModule],
  controllers: [SetsController],
  providers: [SetsService],
})
export class SetsModule {}
