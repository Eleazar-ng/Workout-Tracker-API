import { IsDateString, IsUUID } from 'class-validator';

// Creating a Workout is deliberately narrow: just WHICH Program to freeze
// from and WHEN it's scheduled. There is no `exercises` field here (unlike
// CreateProgramDto) — a Workout's initial exercises always come from the
// Program snapshot; if the user wants different exercises on this specific
// occurrence, they use the structural-edit endpoints (POST/PATCH/DELETE
// /workouts/:id/exercises) AFTER creation, not at creation time.
export class CreateWorkoutDto {
  @IsUUID()
  programId!: string;

  @IsDateString()
  scheduledAt!: string;
}
