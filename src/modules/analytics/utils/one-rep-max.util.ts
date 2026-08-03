// Epley formula: the standard, widely-used estimation of one-rep max
// (e1RM) from a set performed at any rep range. This is what mainstream
// lifting-tracker apps (Strong, Hevy, etc.) actually use to define a "PR"
// — raw weight alone isn't a fair comparison across different rep counts
// (5 reps @ 100kg vs 1 rep @ 110kg aren't directly comparable), but their
// e1RM is.
//
// Formula: 1RM = weight * (1 + reps / 30)
//
// Deliberately NOT applied to single-rep sets specially (some variants
// special-case reps === 1 to just return weight directly) — Epley's
// formula already reduces to `weight * (1 + 1/30)`, a ~3.3% overestimate
// at 1 rep, which is an accepted, well-documented characteristic of this
// formula rather than a bug. Using it uniformly keeps the calculation
// simple and consistent.
export function calculateEstimatedOneRepMax(
  weight: number,
  reps: number,
): number {
  return weight * (1 + reps / 30);
}
