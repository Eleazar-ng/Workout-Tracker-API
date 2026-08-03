export class ProgramAdherenceResponseDto {
  programId!: string;
  programName!: string;
  totalWorkouts!: number;
  completed!: number;
  skipped!: number;
  pending!: number;
  // completed / (completed + skipped) — PENDING workouts are excluded
  // from the denominator since they haven't reached an outcome yet.
  // null (not 0 or NaN) when completed + skipped === 0, i.e. no
  // workouts from this program have reached a resolved outcome yet —
  // there is genuinely no adherence rate to report, which is a
  // different situation from "0% adherence."
  adherenceRate!: number | null;
}
