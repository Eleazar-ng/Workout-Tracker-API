import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DeepMockProxy } from 'jest-mock-extended';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createMockPrismaService,
  resetMockPrismaService,
} from '../../test-utils/mock-prisma';
import { WorkoutStatus } from 'generated/prisma/client';
import { calculateEstimatedOneRepMax } from './utils/one-rep-max.util';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let prisma: DeepMockProxy<PrismaService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AnalyticsService);
  });

  afterEach(() => {
    resetMockPrismaService(prisma);
    jest.useRealTimers();
  });

  // --- getExerciseProgress -------------------------------------------------

  describe('getExerciseProgress', () => {
    it('throws NotFoundException when the exercise does not exist in the catalog', async () => {
      prisma.exercise.findUnique.mockResolvedValue(null);

      await expect(
        service.getExerciseProgress('user-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns null PRs and empty history when the user has never logged this exercise', async () => {
      prisma.exercise.findUnique.mockResolvedValue({
        id: 'ex-1',
        name: 'Bench Press',
      } as never);
      prisma.set.findMany.mockResolvedValue([]);

      const result = await service.getExerciseProgress('user-1', 'ex-1');

      expect(result.weightPr).toBeNull();
      expect(result.bodyweightPr).toBeNull();
      expect(result.history).toEqual([]);
    });

    it('picks the set with the HIGHEST e1RM as the PR, not the heaviest raw weight', async () => {
      // 5 reps @ 100 has a higher e1RM than 1 rep @ 102 (Epley), even
      // though 102 is a heavier raw number — the PR must reflect that.
      prisma.exercise.findUnique.mockResolvedValue({
        id: 'ex-1',
        name: 'Bench Press',
      } as never);
      prisma.set.findMany.mockResolvedValue([
        {
          actualReps: 1,
          actualWeight: 102,
          workoutExercise: {
            workout: { id: 'w1', scheduledAt: new Date('2026-01-01') },
          },
        },
        {
          actualReps: 5,
          actualWeight: 100,
          workoutExercise: {
            workout: { id: 'w2', scheduledAt: new Date('2026-01-08') },
          },
        },
      ] as never);

      const result = await service.getExerciseProgress('user-1', 'ex-1');

      expect(result.weightPr?.workoutId).toBe('w2');
      expect(result.weightPr?.estimatedOneRepMax).toBeCloseTo(
        calculateEstimatedOneRepMax(100, 5),
        5,
      );
    });

    it('keeps the EARLIER achievement when a later set ties the same e1RM (does not overwrite on tie)', async () => {
      prisma.exercise.findUnique.mockResolvedValue({
        id: 'ex-1',
        name: 'Bench Press',
      } as never);
      prisma.set.findMany.mockResolvedValue([
        {
          actualReps: 5,
          actualWeight: 100,
          workoutExercise: {
            workout: { id: 'w-early', scheduledAt: new Date('2026-01-01') },
          },
        },
        {
          actualReps: 5,
          actualWeight: 100, // identical e1RM, later date
          workoutExercise: {
            workout: { id: 'w-later', scheduledAt: new Date('2026-02-01') },
          },
        },
      ] as never);

      const result = await service.getExerciseProgress('user-1', 'ex-1');

      expect(result.weightPr?.workoutId).toBe('w-early');
    });

    it('does not let a LOWER-rep bodyweight attempt overwrite an earlier, higher bodyweightPr', async () => {
      prisma.exercise.findUnique.mockResolvedValue({
        id: 'ex-1',
        name: 'Pull-Up',
      } as never);
      prisma.set.findMany.mockResolvedValue([
        {
          actualReps: 12,
          actualWeight: null,
          workoutExercise: {
            workout: { id: 'w1', scheduledAt: new Date('2026-01-01') },
          },
        },
        {
          actualReps: 8, // lower than the existing bodyweightPr — must not overwrite
          actualWeight: null,
          workoutExercise: {
            workout: { id: 'w2', scheduledAt: new Date('2026-01-08') },
          },
        },
        {
          actualReps: 10,
          actualWeight: null,
          workoutExercise: {
            // Same session as the second entry above — exercises the
            // per-session bestReps comparison too (10 > 8 within w2).
            workout: { id: 'w2', scheduledAt: new Date('2026-01-08') },
          },
        },
      ] as never);

      const result = await service.getExerciseProgress('user-1', 'ex-1');

      expect(result.bodyweightPr).toMatchObject({ reps: 12, workoutId: 'w1' });
      const w2Point = result.history.find((h) => h.workoutId === 'w2');
      expect(w2Point?.bestReps).toBe(10);
    });

    it('tracks weightPr and bodyweightPr independently for the same exercise', async () => {
      prisma.exercise.findUnique.mockResolvedValue({
        id: 'ex-1',
        name: 'Pull-Up',
      } as never);
      prisma.set.findMany.mockResolvedValue([
        {
          actualReps: 10,
          actualWeight: null, // bodyweight
          workoutExercise: {
            workout: { id: 'w1', scheduledAt: new Date('2026-01-01') },
          },
        },
        {
          actualReps: 5,
          actualWeight: 20, // weighted variant
          workoutExercise: {
            workout: { id: 'w2', scheduledAt: new Date('2026-01-08') },
          },
        },
      ] as never);

      const result = await service.getExerciseProgress('user-1', 'ex-1');

      expect(result.bodyweightPr).toMatchObject({ reps: 10 });
      expect(result.weightPr).not.toBeNull();
    });

    it('produces ONE history entry per WORKOUT (not per set), using the best set of that session', async () => {
      prisma.exercise.findUnique.mockResolvedValue({
        id: 'ex-1',
        name: 'Bench Press',
      } as never);
      prisma.set.findMany.mockResolvedValue([
        {
          actualReps: 8,
          actualWeight: 50,
          workoutExercise: {
            workout: { id: 'w1', scheduledAt: new Date('2026-01-01') },
          },
        },
        {
          actualReps: 5,
          actualWeight: 60, // same session, heavier -> should win as bestE1rm
          workoutExercise: {
            workout: { id: 'w1', scheduledAt: new Date('2026-01-01') },
          },
        },
      ] as never);

      const result = await service.getExerciseProgress('user-1', 'ex-1');

      expect(result.history).toHaveLength(1);
      expect(result.history[0].bestE1rm).toBeCloseTo(
        calculateEstimatedOneRepMax(60, 5),
        5,
      );
    });
  });

  // --- getProgramAdherence -------------------------------------------------

  describe('getProgramAdherence', () => {
    it('throws NotFoundException when the program does not belong to the user', async () => {
      prisma.program.findFirst.mockResolvedValue(null);

      await expect(
        service.getProgramAdherence('user-1', 'program-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns adherenceRate=null when nothing has resolved yet (all pending)', async () => {
      prisma.program.findFirst.mockResolvedValue({
        id: 'program-1',
        name: 'Push Day',
      } as never);
      prisma.workout.count
        .mockResolvedValueOnce(0) // completed
        .mockResolvedValueOnce(0) // skipped
        .mockResolvedValueOnce(3); // pending

      const result = await service.getProgramAdherence(
        'user-1',
        'program-1',
      );

      expect(result.adherenceRate).toBeNull();
      expect(result.totalWorkouts).toBe(3);
    });

    it('computes adherenceRate as completed / (completed + skipped), excluding pending', async () => {
      prisma.program.findFirst.mockResolvedValue({
        id: 'program-1',
        name: 'Push Day',
      } as never);
      prisma.workout.count
        .mockResolvedValueOnce(3) // completed
        .mockResolvedValueOnce(1) // skipped
        .mockResolvedValueOnce(5); // pending

      const result = await service.getProgramAdherence(
        'user-1',
        'program-1',
      );

      expect(result.adherenceRate).toBe(0.75); // 3 / (3 + 1)
      expect(result.totalWorkouts).toBe(9);
    });
  });

  // --- getStreak ------------------------------------------------------------

  describe('getStreak', () => {
    beforeEach(() => {
      jest
        .useFakeTimers()
        .setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
    });

    it('returns 0 when the most recent due workout was not completed', async () => {
      prisma.workout.findMany.mockResolvedValue([
        {
          status: WorkoutStatus.SKIPPED,
          scheduledAt: new Date('2026-02-28'),
          completedAt: null,
        },
      ] as never);

      const result = await service.getStreak('user-1');

      expect(result.currentStreak).toBe(0);
      expect(result.lastCompletedWorkoutAt).toBeNull();
    });

    it('counts consecutive COMPLETED workouts and stops at the first non-COMPLETED one', async () => {
      // Ordered most-recent-first, exactly as the real query would return.
      prisma.workout.findMany.mockResolvedValue([
        {
          status: WorkoutStatus.COMPLETED,
          scheduledAt: new Date('2026-02-28'),
          completedAt: new Date('2026-02-28'),
        },
        {
          status: WorkoutStatus.COMPLETED,
          scheduledAt: new Date('2026-02-26'),
          completedAt: new Date('2026-02-26'),
        },
        {
          status: WorkoutStatus.SKIPPED, // breaks the streak here
          scheduledAt: new Date('2026-02-24'),
          completedAt: null,
        },
        {
          status: WorkoutStatus.COMPLETED, // never reached — must NOT count
          scheduledAt: new Date('2026-02-22'),
          completedAt: new Date('2026-02-22'),
        },
      ] as never);

      const result = await service.getStreak('user-1');

      expect(result.currentStreak).toBe(2);
    });

    it("uses the MOST RECENT completed workout's date for lastCompletedWorkoutAt, not an earlier one in the streak", async () => {
      prisma.workout.findMany.mockResolvedValue([
        {
          status: WorkoutStatus.COMPLETED,
          scheduledAt: new Date('2026-02-28'),
          completedAt: new Date('2026-02-28T09:00:00.000Z'),
        },
        {
          status: WorkoutStatus.COMPLETED,
          scheduledAt: new Date('2026-02-26'),
          completedAt: new Date('2026-02-26T09:00:00.000Z'),
        },
      ] as never);

      const result = await service.getStreak('user-1');

      expect(result.lastCompletedWorkoutAt).toEqual(
        new Date('2026-02-28T09:00:00.000Z'),
      );
    });

    it('falls back to scheduledAt when completedAt is unexpectedly null on a COMPLETED workout', async () => {
      prisma.workout.findMany.mockResolvedValue([
        {
          status: WorkoutStatus.COMPLETED,
          scheduledAt: new Date('2026-02-28'),
          completedAt: null, // defensive fallback case
        },
      ] as never);

      const result = await service.getStreak('user-1');

      expect(result.lastCompletedWorkoutAt).toEqual(new Date('2026-02-28'));
    });

    it('only queries workouts with scheduledAt <= now', async () => {
      prisma.workout.findMany.mockResolvedValue([]);

      await service.getStreak('user-1');

      const [[args]] = prisma.workout.findMany.mock.calls;
      expect((args?.where?.scheduledAt as { lte: Date })?.lte).toEqual(
        new Date('2026-03-01T00:00:00.000Z'),
      );
    });
  });

  // --- getSummary + findNewPrsInPeriod (private, tested via getSummary) ----

  describe('getSummary', () => {
    // Keeps the streak/adherence-adjacent calls quiet by default so each
    // test can focus on just the piece it cares about. getSummary calls,
    // in order: workout.count (x2, via Promise.all) -> set.findMany
    // (volume) -> set.findMany (all-time, inside findNewPrsInPeriod) ->
    // workout.findMany (inside getStreak).
    function mockQuietDefaults() {
      prisma.workout.count.mockResolvedValue(0);
      prisma.workout.findMany.mockResolvedValue([]); // getStreak's dueWorkouts
    }

    beforeEach(() => {
      jest
        .useFakeTimers()
        .setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
    });

    it('defaults to a 30-day window ending now when no from/to is provided', async () => {
      mockQuietDefaults();
      prisma.set.findMany.mockResolvedValue([]);

      const result = await service.getSummary('user-1', {});

      expect(result.to).toEqual(new Date('2026-03-01T00:00:00.000Z'));
      expect(result.from).toEqual(new Date('2026-01-30T00:00:00.000Z'));
    });

    it('uses explicit from/to when provided', async () => {
      mockQuietDefaults();
      prisma.set.findMany.mockResolvedValue([]);

      const result = await service.getSummary('user-1', {
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-31T00:00:00.000Z',
      });

      expect(result.from).toEqual(new Date('2026-01-01T00:00:00.000Z'));
      expect(result.to).toEqual(new Date('2026-01-31T00:00:00.000Z'));
    });

    it('computes totalVolume as Σ(reps × weight), excluding bodyweight sets entirely', async () => {
      mockQuietDefaults();
      // Only this first call matters for volume — the second set.findMany
      // call (findNewPrsInPeriod's all-time query) is mocked separately
      // below since it's a distinct call to the same method.
      prisma.set.findMany
        .mockResolvedValueOnce([
          { actualReps: 8, actualWeight: 60 },
          { actualReps: 10, actualWeight: 40 },
        ] as never)
        .mockResolvedValueOnce([]); // all-time query for newPrs — irrelevant here

      const result = await service.getSummary('user-1', {});

      expect(result.totalVolume).toBe(8 * 60 + 10 * 40);
    });

    it('the volume query itself excludes bodyweight sets at the DB level (actualWeight: not null)', async () => {
      mockQuietDefaults();
      prisma.set.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      await service.getSummary('user-1', {});

      const [firstCallArgs] = prisma.set.findMany.mock.calls[0];
      expect(firstCallArgs?.where).toMatchObject({
        actualWeight: { not: null },
      });
    });

    it('includes currentStreak from getStreak in the response', async () => {
      prisma.workout.count.mockResolvedValue(0);
      prisma.set.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      prisma.workout.findMany.mockResolvedValue([
        {
          status: WorkoutStatus.COMPLETED,
          scheduledAt: new Date('2026-02-28'),
          completedAt: new Date('2026-02-28'),
        },
      ] as never);

      const result = await service.getSummary('user-1', {});

      expect(result.currentStreak).toBe(1);
    });

    describe('new-PR detection (all-time history vs. period)', () => {
      it('does NOT flag an in-period set as a new PR if an EARLIER (out-of-period) set already beat it', async () => {
        mockQuietDefaults();
        // First call: volume query (irrelevant, empty). Second call: the
        // all-time history findNewPrsInPeriod uses to compute running max.
        prisma.set.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
          {
            actualReps: 3,
            actualWeight: 120, // huge e1RM, BEFORE the period
            workoutExercise: {
              exerciseId: 'ex-1',
              exercise: { name: 'Squat' },
              workout: {
                id: 'w-before',
                scheduledAt: new Date('2025-12-01'),
              },
            },
          },
          {
            actualReps: 5,
            actualWeight: 100, // lower e1RM, INSIDE the period
            workoutExercise: {
              exerciseId: 'ex-1',
              exercise: { name: 'Squat' },
              workout: {
                id: 'w-in-period',
                scheduledAt: new Date('2026-02-01'),
              },
            },
          },
        ] as never);

        const result = await service.getSummary('user-1', {
          from: '2026-01-01T00:00:00.000Z',
          to: '2026-02-28T00:00:00.000Z',
        });

        expect(result.newPrs).toHaveLength(0);
      });

      it('DOES flag a genuinely new PR set inside the period', async () => {
        mockQuietDefaults();
        prisma.set.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
          {
            actualReps: 5,
            actualWeight: 80,
            workoutExercise: {
              exerciseId: 'ex-1',
              exercise: { name: 'Squat' },
              workout: {
                id: 'w-before',
                scheduledAt: new Date('2025-12-01'),
              },
            },
          },
          {
            actualReps: 5,
            actualWeight: 100, // genuinely higher, inside the period
            workoutExercise: {
              exerciseId: 'ex-1',
              exercise: { name: 'Squat' },
              workout: {
                id: 'w-in-period',
                scheduledAt: new Date('2026-02-01'),
              },
            },
          },
        ] as never);

        const result = await service.getSummary('user-1', {
          from: '2026-01-01T00:00:00.000Z',
          to: '2026-02-28T00:00:00.000Z',
        });

        expect(result.newPrs).toHaveLength(1);
        expect(result.newPrs[0]).toMatchObject({
          exerciseId: 'ex-1',
          type: 'WEIGHT',
          workoutId: 'w-in-period',
        });
      });

      it('does NOT flag a set that merely TIES the running max (strictly greater required)', async () => {
        mockQuietDefaults();
        prisma.set.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
          {
            actualReps: 5,
            actualWeight: 100,
            workoutExercise: {
              exerciseId: 'ex-1',
              exercise: { name: 'Squat' },
              workout: {
                id: 'w-before',
                scheduledAt: new Date('2025-12-01'),
              },
            },
          },
          {
            actualReps: 5,
            actualWeight: 100, // identical e1RM — a tie, not a new record
            workoutExercise: {
              exerciseId: 'ex-1',
              exercise: { name: 'Squat' },
              workout: {
                id: 'w-in-period',
                scheduledAt: new Date('2026-02-01'),
              },
            },
          },
        ] as never);

        const result = await service.getSummary('user-1', {
          from: '2026-01-01T00:00:00.000Z',
          to: '2026-02-28T00:00:00.000Z',
        });

        expect(result.newPrs).toHaveLength(0);
      });

      it('tracks WEIGHT and BODYWEIGHT running maxes independently for the same exercise', async () => {
        mockQuietDefaults();
        prisma.set.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
          {
            actualReps: 10,
            actualWeight: null, // bodyweight PR, inside period
            workoutExercise: {
              exerciseId: 'ex-1',
              exercise: { name: 'Pull-Up' },
              workout: { id: 'w-bw', scheduledAt: new Date('2026-02-01') },
            },
          },
          {
            actualReps: 5,
            actualWeight: 20, // weighted PR, inside period, same exercise
            workoutExercise: {
              exerciseId: 'ex-1',
              exercise: { name: 'Pull-Up' },
              workout: {
                id: 'w-weighted',
                scheduledAt: new Date('2026-02-02'),
              },
            },
          },
        ] as never);

        const result = await service.getSummary('user-1', {
          from: '2026-01-01T00:00:00.000Z',
          to: '2026-02-28T00:00:00.000Z',
        });

        expect(result.newPrs).toHaveLength(2);
        expect(result.newPrs.map((pr) => pr.type).sort()).toEqual([
          'BODYWEIGHT',
          'WEIGHT',
        ]);
      });

      it('does NOT flag a bodyweight attempt that fails to exceed the running max', async () => {
        mockQuietDefaults();
        prisma.set.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
          {
            actualReps: 12,
            actualWeight: null,
            workoutExercise: {
              exerciseId: 'ex-1',
              exercise: { name: 'Pull-Up' },
              workout: { id: 'w1', scheduledAt: new Date('2026-01-15') },
            },
          },
          {
            actualReps: 8, // lower — must not be flagged as a new PR
            actualWeight: null,
            workoutExercise: {
              exerciseId: 'ex-1',
              exercise: { name: 'Pull-Up' },
              workout: { id: 'w2', scheduledAt: new Date('2026-02-01') },
            },
          },
        ] as never);

        const result = await service.getSummary('user-1', {
          from: '2026-01-01T00:00:00.000Z',
          to: '2026-02-28T00:00:00.000Z',
        });

        // The FIRST set (w1, 12 reps) is inside the period and is a
        // genuine first-time PR — it should be flagged. The second (w2,
        // 8 reps) must not be, since it doesn't exceed the running max.
        expect(result.newPrs).toHaveLength(1);
        expect(result.newPrs[0].workoutId).toBe('w1');
      });

      it('only flags a PR moment for the exercise it actually belongs to (does not cross-contaminate running maxes between exercises)', async () => {
        mockQuietDefaults();
        prisma.set.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
          {
            actualReps: 1,
            actualWeight: 200, // huge e1RM but a DIFFERENT exercise
            workoutExercise: {
              exerciseId: 'ex-deadlift',
              exercise: { name: 'Deadlift' },
              workout: { id: 'w-dl', scheduledAt: new Date('2025-12-01') },
            },
          },
          {
            actualReps: 5,
            actualWeight: 60, // modest e1RM, but a genuine first PR for Squat
            workoutExercise: {
              exerciseId: 'ex-squat',
              exercise: { name: 'Squat' },
              workout: { id: 'w-sq', scheduledAt: new Date('2026-02-01') },
            },
          },
        ] as never);

        const result = await service.getSummary('user-1', {
          from: '2026-01-01T00:00:00.000Z',
          to: '2026-02-28T00:00:00.000Z',
        });

        expect(result.newPrs).toHaveLength(1);
        expect(result.newPrs[0].exerciseId).toBe('ex-squat');
      });
    });
  });
});
