import { IsInt, IsNumber, IsUUID, Min } from 'class-validator';

// Mirrors ProgramExerciseInputDto's shape (same fixed-target-per-set
// model), but this is for adding an exercise directly to a live Workout
// instance — not a Program template. The exercise still must exist in the
// global catalog (validated in the service), same as everywhere else
// exerciseId is accepted.
export class AddWorkoutExerciseDto {
  @IsUUID()
  exerciseId!: string;

  @IsInt()
  @Min(0)
  order!: number;

  @IsInt()
  @Min(1)
  setsCount!: number;

  @IsInt()
  @Min(1)
  targetReps!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  targetWeight!: number;
}
