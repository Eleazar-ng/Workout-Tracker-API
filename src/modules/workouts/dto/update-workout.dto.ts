import { IsDateString, IsIn, IsOptional } from 'class-validator';

// Deliberately NOT using the full WorkoutStatus enum here. COMPLETED is
// excluded on purpose — per our Stage 6 decision, completion is derived
// automatically by WorkoutsService.recomputeCompletionStatus() once every
// Set has actuals recorded. A client attempting to PATCH status straight
// to COMPLETED should get a clear validation error, not silently succeed
// and then potentially be overwritten by the next auto-recompute.
const MANUALLY_SETTABLE_STATUSES = ['PENDING', 'SKIPPED'] as const;

export class UpdateWorkoutDto {
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsIn(MANUALLY_SETTABLE_STATUSES, {
    message:
      'status must be one of: PENDING, SKIPPED. COMPLETED is set automatically once all sets have recorded actuals.',
  })
  status?: (typeof MANUALLY_SETTABLE_STATUSES)[number];
}
