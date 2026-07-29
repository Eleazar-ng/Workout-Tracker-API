import { WorkoutStatus } from "generated/prisma/enums";

// Includes workoutStatus as a convenience field — since updating a Set's
// actuals can trigger the parent Workout's auto-completion
// (WorkoutsService.recomputeCompletionStatus), returning the workout's
// current status alongside the set means the client immediately knows if
// this update just completed the workout, without a separate follow-up
// GET /workouts/:id call.
export class SetResponseDto {
  id!: string;
  setNumber!: number;
  targetReps!: number;
  targetWeight!: number;
  actualReps!: number | null;
  actualWeight!: number | null;
  completedAt!: Date | null;
  workoutId!: string;
  workoutStatus!: WorkoutStatus;
}
