import { Module } from '@nestjs/common';
import { WorkoutsController } from './workouts.controller';
import { WorkoutsService } from './workouts.service';

@Module({
  controllers: [WorkoutsController],
  providers: [WorkoutsService],
  // Exported because Stage 7's SetsService needs to call
  // WorkoutsService.recomputeCompletionStatus() every time a Set's
  // actuals are recorded — see the cross-stage contract noted when this
  // stage was planned.
  exports: [WorkoutsService],
})
export class WorkoutsModule {}
