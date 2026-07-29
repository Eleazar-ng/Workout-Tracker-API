import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';

// Both fields are independently optional — a client can update just
// actualReps, just actualWeight, or both in one call. class-validator's
// @IsOptional() treats BOTH `undefined` and explicit `null` as "skip
// further validators on this property" (this is documented, built-in
// behavior — no extra @ValidateIf needed), which is exactly what we want:
// `null` is a meaningful value here (see actualWeight's reasoning below),
// not an absence to be rejected by @IsInt()/@IsNumber().
//
// actualWeight may legitimately be null even when actualReps is set —
// e.g. bodyweight exercises (pull-ups, dips) have no meaningful weight
// value. actualReps is the field that drives Workout completion
// derivation (see WorkoutsService.recomputeCompletionStatus); actualWeight
// never gates completion.
export class UpdateSetDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  actualReps?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  actualWeight?: number | null;
}
