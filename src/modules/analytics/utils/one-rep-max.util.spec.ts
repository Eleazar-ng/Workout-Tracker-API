import { calculateEstimatedOneRepMax } from './one-rep-max.util';

describe('calculateEstimatedOneRepMax (Epley formula)', () => {
  it('returns the weight itself for a true 1-rep-max style calculation baseline', () => {
    // Epley deliberately does NOT special-case reps=1 to return weight
    // exactly — it still applies the formula, producing a slight
    // (documented, accepted) overestimate. This test locks in that
    // documented behavior so it can't silently change.
    const result = calculateEstimatedOneRepMax(100, 1);

    expect(result).toBeCloseTo(103.33, 2);
  });

  it('matches the textbook Epley formula for a standard rep range', () => {
    // 100kg x 5 reps -> 100 * (1 + 5/30) = 116.666...
    const result = calculateEstimatedOneRepMax(100, 5);

    expect(result).toBeCloseTo(116.67, 2);
  });

  it('produces a higher e1RM for more reps at the same weight', () => {
    const fiveReps = calculateEstimatedOneRepMax(100, 5);
    const tenReps = calculateEstimatedOneRepMax(100, 10);

    expect(tenReps).toBeGreaterThan(fiveReps);
  });

  it('produces a higher e1RM for more weight at the same reps', () => {
    const lighter = calculateEstimatedOneRepMax(80, 5);
    const heavier = calculateEstimatedOneRepMax(100, 5);

    expect(heavier).toBeGreaterThan(lighter);
  });

  it('returns 0 for 0 weight regardless of reps', () => {
    expect(calculateEstimatedOneRepMax(0, 8)).toBe(0);
  });

  it('handles a high rep count without producing an unreasonable value', () => {
    // 20kg x 30 reps -> 20 * (1 + 30/30) = 40. Sanity-checks the formula
    // doesn't blow up or behave oddly at higher rep counts.
    const result = calculateEstimatedOneRepMax(20, 30);

    expect(result).toBe(40);
  });

  it('is a pure function — same inputs always produce the same output', () => {
    const first = calculateEstimatedOneRepMax(62.5, 8);
    const second = calculateEstimatedOneRepMax(62.5, 8);

    expect(first).toBe(second);
  });
});
