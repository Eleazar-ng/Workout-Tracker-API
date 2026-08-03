// A single historical data point — one per Workout in which this exercise
// appeared, capturing the BEST set performed that session (not every
// individual set), which is the standard "progress chart" shape used by
// lifting apps: one point per session, not one point per set.
export class ProgressPointDto {
  workoutId!: string;
  date!: Date; // workout.scheduledAt
  bestE1rm!: number | null; // null if this session had no weighted sets
  bestReps!: number | null; // best bodyweight-set reps, if any
}

export class WeightPrDto {
  estimatedOneRepMax!: number;
  weight!: number;
  reps!: number;
  achievedAt!: Date;
  workoutId!: string;
}

export class BodyweightPrDto {
  reps!: number;
  achievedAt!: Date;
  workoutId!: string;
}

// Both PR fields are independently nullable — an exercise a user has only
// ever done with weight will have bodyweightPr: null, and vice versa. Both
// can be non-null if the user has logged the same exercise both ways
// (e.g. weighted pull-ups some days, bodyweight pull-ups others).
export class ExerciseProgressResponseDto {
  exerciseId!: string;
  exerciseName!: string;
  weightPr!: WeightPrDto | null;
  bodyweightPr!: BodyweightPrDto | null;
  history!: ProgressPointDto[];
}
