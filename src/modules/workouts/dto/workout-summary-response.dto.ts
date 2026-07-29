import { WorkoutStatus } from "generated/prisma/enums";

// Mirrors ProgramSummaryResponseDto's reasoning — a list view doesn't need
// full nested exercises/sets/comments, just enough to render a list and
// let the user pick which Workout to open. Full detail lives in
// WorkoutDetailResponseDto (GET /workouts/:id).
export class WorkoutSummaryResponseDto {
  id!: string;
  name!: string;
  scheduledAt!: Date;
  status!: WorkoutStatus;
  completedAt!: Date | null;
  exerciseCount!: number;
  createdAt!: Date;
}
