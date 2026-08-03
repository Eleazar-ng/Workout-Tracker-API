// A "new PR" here means a genuine record-breaking moment — the set that
// pushed an exercise's running-best e1RM (or running-best bodyweight
// reps) higher than every earlier set for that exercise, AND whose date
// falls within the requested period. This is NOT the same as "any high
// value logged in this period" — see AnalyticsService.getSummary for how
// the running-max comparison is actually computed.
export class NewPrDto {
  exerciseId!: string;
  exerciseName!: string;
  type!: 'WEIGHT' | 'BODYWEIGHT';
  value!: number; // estimatedOneRepMax for WEIGHT, reps for BODYWEIGHT
  achievedAt!: Date;
  workoutId!: string;
}

export class AnalyticsSummaryResponseDto {
  from!: Date;
  to!: Date;
  workoutsCompleted!: number;
  workoutsSkipped!: number;
  // Sum of (actualReps * actualWeight) across all weighted sets in
  // workouts scheduled within the period. Bodyweight sets excluded — see
  // deferred-decisions.md for why (no bodyweight-load estimation).
  totalVolume!: number;
  newPrs!: NewPrDto[];
  currentStreak!: number;
}
