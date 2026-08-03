import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DateRangeQueryDto } from './dto/date-range-query.dto';
import {
  BodyweightPrDto,
  ExerciseProgressResponseDto,
  ProgressPointDto,
  WeightPrDto,
} from './dto/exercise-progress-response.dto';
import { ProgramAdherenceResponseDto } from './dto/program-adherence-response.dto';
import { StreakResponseDto } from './dto/streak-response.dto';
import {
  AnalyticsSummaryResponseDto,
  NewPrDto,
} from './dto/analytics-summary-response.dto';
import { calculateEstimatedOneRepMax } from './utils/one-rep-max.util';
import { WorkoutStatus } from 'generated/prisma/enums';

const DEFAULT_SUMMARY_WINDOW_DAYS = 30;

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Per-exercise progress + PRs -----------------------------------------

  async getExerciseProgress(
    userId: string,
    exerciseId: string,
  ): Promise<ExerciseProgressResponseDto> {
    const exercise = await this.prisma.exercise.findUnique({
      where: { id: exerciseId },
      select: { id: true, name: true },
    });
    if (!exercise) {
      throw new NotFoundException(`Exercise with id "${exerciseId}" not found`);
    }

    // Only sets that were actually performed (actualReps recorded) count
    // — a frozen target with no actual is not performance data. Ordered
    // chronologically ascending by the WORKOUT's scheduledAt (not the
    // set's own completedAt) — see this module's date-dimension
    // convention noted in getSummary below, applied consistently here too.
    const sets = await this.prisma.set.findMany({
      where: {
        actualReps: { not: null },
        workoutExercise: { exerciseId, workout: { userId } },
      },
      select: {
        actualReps: true,
        actualWeight: true,
        workoutExercise: {
          select: { workout: { select: { id: true, scheduledAt: true } } },
        },
      },
      orderBy: { workoutExercise: { workout: { scheduledAt: 'asc' } } },
    });

    const byWorkout = new Map<
      string,
      { date: Date; bestE1rm: number | null; bestReps: number | null }
    >();
    let weightPr: WeightPrDto | null = null;
    let bodyweightPr: BodyweightPrDto | null = null;

    // Single forward pass, chronological order — this is what makes both
    // the per-session history AND the all-time PR correct in one loop:
    // PRs are naturally the first time a running max is exceeded, ties
    // don't overwrite an earlier achievement.
    for (const row of sets) {
      const workoutId = row.workoutExercise.workout.id;
      const date = row.workoutExercise.workout.scheduledAt;
      const reps = row.actualReps as number; // non-null: filtered in `where`

      if (!byWorkout.has(workoutId)) {
        byWorkout.set(workoutId, { date, bestE1rm: null, bestReps: null });
      }
      const point = byWorkout.get(workoutId)!;

      if (row.actualWeight !== null) {
        const weight = Number(row.actualWeight);
        const e1rm = calculateEstimatedOneRepMax(weight, reps);

        if (point.bestE1rm === null || e1rm > point.bestE1rm) {
          point.bestE1rm = e1rm;
        }
        if (!weightPr || e1rm > weightPr.estimatedOneRepMax) {
          weightPr = {
            estimatedOneRepMax: e1rm,
            weight,
            reps,
            achievedAt: date,
            workoutId,
          };
        }
      } else {
        if (point.bestReps === null || reps > point.bestReps) {
          point.bestReps = reps;
        }
        if (!bodyweightPr || reps > bodyweightPr.reps) {
          bodyweightPr = { reps, achievedAt: date, workoutId };
        }
      }
    }

    const history: ProgressPointDto[] = Array.from(byWorkout.entries()).map(
      ([workoutId, v]) => ({
        workoutId,
        date: v.date,
        bestE1rm: v.bestE1rm,
        bestReps: v.bestReps,
      }),
    );

    return {
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      weightPr,
      bodyweightPr,
      history,
    };
  }

  // --- Per-program adherence ------------------------------------------------

  async getProgramAdherence(
    userId: string,
    programId: string,
  ): Promise<ProgramAdherenceResponseDto> {
    const program = await this.prisma.program.findFirst({
      where: { id: programId, userId },
      select: { id: true, name: true },
    });
    if (!program) {
      throw new NotFoundException(`Program with id "${programId}" not found`);
    }

    const [completed, skipped, pending] = await Promise.all([
      this.prisma.workout.count({
        where: { programId, status: WorkoutStatus.COMPLETED },
      }),
      this.prisma.workout.count({
        where: { programId, status: WorkoutStatus.SKIPPED },
      }),
      this.prisma.workout.count({
        where: { programId, status: WorkoutStatus.PENDING },
      }),
    ]);

    const resolvedTotal = completed + skipped;

    return {
      programId: program.id,
      programName: program.name,
      totalWorkouts: completed + skipped + pending,
      completed,
      skipped,
      pending,
      // null (not 0) when nothing has resolved yet — "no data" and "0%"
      // are meaningfully different states for a client to render.
      adherenceRate: resolvedTotal > 0 ? completed / resolvedTotal : null,
    };
  }

  // --- Streak ----------------------------------------------------------------

  async getStreak(userId: string): Promise<StreakResponseDto> {
    const now = new Date();

    // Only workouts already due (scheduledAt <= now) — a future PENDING
    // workout hasn't happened yet and shouldn't affect the streak either
    // way. Ordered most-recent-first so we can walk backward from "today"
    // and stop at the first gap.
    const dueWorkouts = await this.prisma.workout.findMany({
      where: { userId, scheduledAt: { lte: now } },
      orderBy: { scheduledAt: 'desc' },
      select: { status: true, scheduledAt: true, completedAt: true },
    });

    let currentStreak = 0;
    let lastCompletedWorkoutAt: Date | null = null;

    // Per our Stage 8 decision: a streak is a run of consecutive
    // COMPLETED workouts, broken by ANY non-COMPLETED past-due workout —
    // whether explicitly SKIPPED or simply left PENDING and now overdue.
    // Both represent "didn't do it." Calendar gaps between workouts don't
    // matter, only the workouts that were actually scheduled.
    for (const workout of dueWorkouts) {
      if (workout.status === WorkoutStatus.COMPLETED) {
        currentStreak += 1;
        if (lastCompletedWorkoutAt === null) {
          lastCompletedWorkoutAt = workout.completedAt ?? workout.scheduledAt;
        }
      } else {
        break;
      }
    }

    return { currentStreak, lastCompletedWorkoutAt };
  }

  // --- Period summary ----------------------------------------------------------

  async getSummary(
    userId: string,
    query: DateRangeQueryDto,
  ): Promise<AnalyticsSummaryResponseDto> {
    // Date dimension convention for this whole module: workout.scheduledAt,
    // not any individual set's completedAt. scheduledAt is the single,
    // authoritative "when did this occur" value for a Workout and every
    // Set under it — using one consistent field avoids ambiguity between
    // "when scheduled" vs "when logged."
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(
          to.getTime() - DEFAULT_SUMMARY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        );

    const [workoutsCompleted, workoutsSkipped] = await Promise.all([
      this.prisma.workout.count({
        where: {
          userId,
          status: WorkoutStatus.COMPLETED,
          scheduledAt: { gte: from, lte: to },
        },
      }),
      this.prisma.workout.count({
        where: {
          userId,
          status: WorkoutStatus.SKIPPED,
          scheduledAt: { gte: from, lte: to },
        },
      }),
    ]);

    const weightedSetsInPeriod = await this.prisma.set.findMany({
      where: {
        actualReps: { not: null },
        actualWeight: { not: null },
        workoutExercise: {
          workout: { userId, scheduledAt: { gte: from, lte: to } },
        },
      },
      select: { actualReps: true, actualWeight: true },
    });

    // Volume = tonnage = Σ(reps × weight). Bodyweight sets are excluded
    // entirely (not counted as zero) — see deferred-decisions.md.
    const totalVolume = weightedSetsInPeriod.reduce(
      (sum, s) => sum + (s.actualReps as number) * Number(s.actualWeight),
      0,
    );

    const newPrs = await this.findNewPrsInPeriod(userId, from, to);
    const { currentStreak } = await this.getStreak(userId);

    return {
      from,
      to,
      workoutsCompleted,
      workoutsSkipped,
      totalVolume,
      newPrs,
      currentStreak,
    };
  }

  // Determining "new PRs in [from, to]" requires ALL-TIME history, not
  // just the period's data — a high value inside the period is only a
  // genuine PR if it's higher than everything that came BEFORE the
  // period too. This walks every set the user has ever logged, in
  // chronological order, tracking a running best-so-far per exercise per
  // PR type, and records a "PR moment" only when a set exceeds that
  // running max AND falls within the requested period.
  private async findNewPrsInPeriod(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<NewPrDto[]> {
    const allSets = await this.prisma.set.findMany({
      where: {
        actualReps: { not: null },
        workoutExercise: { workout: { userId } },
      },
      select: {
        actualReps: true,
        actualWeight: true,
        workoutExercise: {
          select: {
            exerciseId: true,
            exercise: { select: { name: true } },
            workout: { select: { id: true, scheduledAt: true } },
          },
        },
      },
      orderBy: { workoutExercise: { workout: { scheduledAt: 'asc' } } },
    });

    const runningWeightMax = new Map<string, number>();
    const runningBodyweightMax = new Map<string, number>();
    const newPrs: NewPrDto[] = [];

    for (const row of allSets) {
      const { exerciseId, exercise, workout } = row.workoutExercise;
      const inPeriod = workout.scheduledAt >= from && workout.scheduledAt <= to;
      const reps = row.actualReps as number;

      if (row.actualWeight !== null) {
        const e1rm = calculateEstimatedOneRepMax(
          Number(row.actualWeight),
          reps,
        );
        const runningMax = runningWeightMax.get(exerciseId) ?? -Infinity;

        if (e1rm > runningMax) {
          runningWeightMax.set(exerciseId, e1rm);
          if (inPeriod) {
            newPrs.push({
              exerciseId,
              exerciseName: exercise.name,
              type: 'WEIGHT',
              value: e1rm,
              achievedAt: workout.scheduledAt,
              workoutId: workout.id,
            });
          }
        }
      } else {
        const runningMax = runningBodyweightMax.get(exerciseId) ?? -Infinity;

        if (reps > runningMax) {
          runningBodyweightMax.set(exerciseId, reps);
          if (inPeriod) {
            newPrs.push({
              exerciseId,
              exerciseName: exercise.name,
              type: 'BODYWEIGHT',
              value: reps,
              achievedAt: workout.scheduledAt,
              workoutId: workout.id,
            });
          }
        }
      }
    }

    return newPrs;
  }
}
