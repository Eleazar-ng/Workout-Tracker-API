import { IsInt, Min } from 'class-validator';

// Only setsCount is editable on an existing WorkoutExercise — changing
// targetReps/targetWeight after the fact would mean silently rewriting
// history for sets that may already have actuals recorded against the old
// target, which defeats the purpose of freezing targets in the first
// place. If a user wants different targets, the intended path is deleting
// this exercise and re-adding it with the new targets (which starts a
// clean set of Set rows with no stale-target ambiguity).
export class UpdateWorkoutExerciseDto {
  @IsInt()
  @Min(1)
  setsCount!: number;
}
