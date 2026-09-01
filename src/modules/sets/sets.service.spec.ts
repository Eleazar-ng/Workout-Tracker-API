import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DeepMockProxy } from 'jest-mock-extended';
import { SetsService } from './sets.service';
import { WorkoutsService } from '../workouts/workouts.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createMockPrismaService,
  resetMockPrismaService,
} from '../../test-utils/mock-prisma';
import { WorkoutStatus } from 'generated/prisma/client';

describe('SetsService', () => {
  let service: SetsService;
  let prisma: DeepMockProxy<PrismaService>;
  let workoutsService: jest.Mocked<
    Pick<WorkoutsService, 'recomputeCompletionStatus'>
  >;

  const buildSetWithWorkout = (
    overrides: {
      actualReps?: number | null;
      actualWeight?: number | null;
      workoutStatus?: WorkoutStatus;
    } = {},
  ) => ({
    id: 'set-1',
    setNumber: 1,
    targetReps: 8,
    targetWeight: 60,
    actualReps: overrides.actualReps ?? null,
    actualWeight: overrides.actualWeight ?? null,
    completedAt: null,
    workoutExercise: {
      workout: {
        id: 'workout-1',
        status: overrides.workoutStatus ?? WorkoutStatus.PENDING,
      },
    },
  });

  beforeEach(async () => {
    prisma = createMockPrismaService();
    workoutsService = {
      recomputeCompletionStatus: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        SetsService,
        { provide: PrismaService, useValue: prisma },
        { provide: WorkoutsService, useValue: workoutsService },
      ],
    }).compile();

    service = module.get(SetsService);
  });

  afterEach(() => {
    resetMockPrismaService(prisma);
  });

  it('throws ConflictException when neither actualReps nor actualWeight is provided', async () => {
    await expect(
      service.updateActuals('user-1', 'set-1', {}),
    ).rejects.toThrow(ConflictException);

    expect(prisma.set.findFirst).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the set does not exist or is not owned', async () => {
    prisma.set.findFirst.mockResolvedValue(null);

    await expect(
      service.updateActuals('user-1', 'set-1', { actualReps: 8 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('scopes ownership via the full Set -> WorkoutExercise -> Workout -> userId join', async () => {
    prisma.set.findFirst.mockResolvedValue(null);

    await expect(
      service.updateActuals('user-1', 'set-1', { actualReps: 8 }),
    ).rejects.toThrow(NotFoundException);

    const [[args]] = prisma.set.findFirst.mock.calls;
    expect(args?.where).toEqual({
      id: 'set-1',
      workoutExercise: { workout: { userId: 'user-1' } },
    });
  });

  describe('when the workout is NOT locked (PENDING/SKIPPED)', () => {
    it('sets completedAt when actualReps transitions from null to non-null for the first time', async () => {
      prisma.set.findFirst.mockResolvedValue(
        buildSetWithWorkout({ actualReps: null }) as never,
      );
      prisma.set.update.mockResolvedValue(
        buildSetWithWorkout({ actualReps: 8 }) as never,
      );
      prisma.workout.findUniqueOrThrow.mockResolvedValue({
        status: WorkoutStatus.PENDING,
      } as never);

      await service.updateActuals('user-1', 'set-1', { actualReps: 8 });

      const [[args]] = prisma.set.update.mock.calls;
      expect(
        (args?.data as { completedAt: Date }).completedAt,
      ).toBeInstanceOf(Date);
    });

    it('does NOT touch completedAt when correcting an already-recorded actualReps', async () => {
      prisma.set.findFirst.mockResolvedValue(
        buildSetWithWorkout({ actualReps: 8 }) as never, // already recorded
      );
      prisma.set.update.mockResolvedValue(
        buildSetWithWorkout({ actualReps: 10 }) as never,
      );
      prisma.workout.findUniqueOrThrow.mockResolvedValue({
        status: WorkoutStatus.PENDING,
      } as never);

      await service.updateActuals('user-1', 'set-1', { actualReps: 10 });

      const [[args]] = prisma.set.update.mock.calls;
      expect(args?.data).not.toHaveProperty('completedAt');
    });

    it('clears completedAt when un-setting actualReps back to null (allowed pre-completion)', async () => {
      prisma.set.findFirst.mockResolvedValue(
        buildSetWithWorkout({ actualReps: 8 }) as never,
      );
      prisma.set.update.mockResolvedValue(
        buildSetWithWorkout({ actualReps: null }) as never,
      );
      prisma.workout.findUniqueOrThrow.mockResolvedValue({
        status: WorkoutStatus.PENDING,
      } as never);

      await service.updateActuals('user-1', 'set-1', { actualReps: null });

      const [[args]] = prisma.set.update.mock.calls;
      expect(args?.data).toMatchObject({
        actualReps: null,
        completedAt: null,
      });
    });

    it('allows updating actualWeight independently without requiring actualReps (bodyweight support)', async () => {
      prisma.set.findFirst.mockResolvedValue(
        buildSetWithWorkout({
          actualReps: null,
          actualWeight: null,
        }) as never,
      );
      prisma.set.update.mockResolvedValue(
        buildSetWithWorkout({ actualWeight: 20 }) as never,
      );
      prisma.workout.findUniqueOrThrow.mockResolvedValue({
        status: WorkoutStatus.PENDING,
      } as never);

      await service.updateActuals('user-1', 'set-1', { actualWeight: 20 });

      const [[args]] = prisma.set.update.mock.calls;
      expect(args?.data).toEqual({ actualWeight: 20 });
      // completedAt is driven ONLY by actualReps, never by actualWeight —
      // per our Stage 7 decision that reps is the sole completion signal.
      expect(args?.data).not.toHaveProperty('completedAt');
    });
  });

  describe('when the workout IS locked (COMPLETED)', () => {
    it('allows correcting actualReps to a different non-null value', async () => {
      prisma.set.findFirst.mockResolvedValue(
        buildSetWithWorkout({
          actualReps: 8,
          workoutStatus: WorkoutStatus.COMPLETED,
        }) as never,
      );
      prisma.set.update.mockResolvedValue(
        buildSetWithWorkout({ actualReps: 10 }) as never,
      );
      prisma.workout.findUniqueOrThrow.mockResolvedValue({
        status: WorkoutStatus.COMPLETED,
      } as never);

      await expect(
        service.updateActuals('user-1', 'set-1', { actualReps: 10 }),
      ).resolves.toBeDefined();
    });

    it('allows correcting actualWeight to a different non-null value', async () => {
      prisma.set.findFirst.mockResolvedValue(
        buildSetWithWorkout({
          actualReps: 8,
          actualWeight: 60,
          workoutStatus: WorkoutStatus.COMPLETED,
        }) as never,
      );
      prisma.set.update.mockResolvedValue(
        buildSetWithWorkout({ actualWeight: 65 }) as never,
      );
      prisma.workout.findUniqueOrThrow.mockResolvedValue({
        status: WorkoutStatus.COMPLETED,
      } as never);

      await expect(
        service.updateActuals('user-1', 'set-1', { actualWeight: 65 }),
      ).resolves.toBeDefined();
    });

    it('BLOCKS un-setting actualReps back to null', async () => {
      prisma.set.findFirst.mockResolvedValue(
        buildSetWithWorkout({
          actualReps: 8,
          workoutStatus: WorkoutStatus.COMPLETED,
        }) as never,
      );

      await expect(
        service.updateActuals('user-1', 'set-1', { actualReps: null }),
      ).rejects.toThrow(ConflictException);

      expect(prisma.set.update).not.toHaveBeenCalled();
    });

    it('BLOCKS un-setting actualWeight back to null', async () => {
      prisma.set.findFirst.mockResolvedValue(
        buildSetWithWorkout({
          actualReps: 8,
          actualWeight: 60,
          workoutStatus: WorkoutStatus.COMPLETED,
        }) as never,
      );

      await expect(
        service.updateActuals('user-1', 'set-1', { actualWeight: null }),
      ).rejects.toThrow(ConflictException);

      expect(prisma.set.update).not.toHaveBeenCalled();
    });

    it('allows setting actualWeight for the FIRST time even though the workout is already completed (reps alone gate completion)', async () => {
      prisma.set.findFirst.mockResolvedValue(
        buildSetWithWorkout({
          actualReps: 8,
          actualWeight: null, // never recorded — legitimate for bodyweight sets
          workoutStatus: WorkoutStatus.COMPLETED,
        }) as never,
      );
      prisma.set.update.mockResolvedValue(
        buildSetWithWorkout({ actualWeight: 20 }) as never,
      );
      prisma.workout.findUniqueOrThrow.mockResolvedValue({
        status: WorkoutStatus.COMPLETED,
      } as never);

      // NOT a "reverting" case — the previous value was already null, not
      // a recorded non-null value being cleared — so this must succeed.
      await expect(
        service.updateActuals('user-1', 'set-1', { actualWeight: 20 }),
      ).resolves.toBeDefined();
    });
  });

  it('calls recomputeCompletionStatus with the workout id after every update', async () => {
    prisma.set.findFirst.mockResolvedValue(buildSetWithWorkout() as never);
    prisma.set.update.mockResolvedValue(buildSetWithWorkout() as never);
    prisma.workout.findUniqueOrThrow.mockResolvedValue({
      status: WorkoutStatus.PENDING,
    } as never);

    await service.updateActuals('user-1', 'set-1', { actualReps: 8 });

    expect(workoutsService.recomputeCompletionStatus).toHaveBeenCalledWith(
      'workout-1',
    );
  });

  it('returns the POST-recompute workout status, not the pre-update snapshot', async () => {
    // The set/workout join used for ownership sees PENDING (before this
    // update), but recomputeCompletionStatus may complete the workout as
    // a result of THIS update — the response must reflect that, requiring
    // a fresh read afterward rather than reusing the stale snapshot.
    prisma.set.findFirst.mockResolvedValue(
      buildSetWithWorkout({ workoutStatus: WorkoutStatus.PENDING }) as never,
    );
    prisma.set.update.mockResolvedValue(
      buildSetWithWorkout({ actualReps: 8 }) as never,
    );
    prisma.workout.findUniqueOrThrow.mockResolvedValue({
      status: WorkoutStatus.COMPLETED, // now completed, post-recompute
    } as never);

    const result = await service.updateActuals('user-1', 'set-1', {
      actualReps: 8,
    });

    expect(result.workoutStatus).toBe(WorkoutStatus.COMPLETED);
  });

  it('maps Decimal-like fields to numbers, including a null actualWeight', async () => {
    prisma.set.findFirst.mockResolvedValue(buildSetWithWorkout() as never);
    prisma.set.update.mockResolvedValue({
      id: 'set-1',
      setNumber: 1,
      targetReps: 8,
      targetWeight: 60,
      actualReps: 8,
      actualWeight: null,
      completedAt: new Date(),
    } as never);
    prisma.workout.findUniqueOrThrow.mockResolvedValue({
      status: WorkoutStatus.PENDING,
    } as never);

    const result = await service.updateActuals('user-1', 'set-1', {
      actualReps: 8,
    });

    expect(typeof result.targetWeight).toBe('number');
    expect(result.actualWeight).toBeNull();
  });

  it('preserves a non-null actualWeight as a number', async () => {
    prisma.set.findFirst.mockResolvedValue(buildSetWithWorkout() as never);
    prisma.set.update.mockResolvedValue({
      id: 'set-1',
      setNumber: 1,
      targetReps: 8,
      targetWeight: 60,
      actualReps: 8,
      actualWeight: 62.5,
      completedAt: new Date(),
    } as never);
    prisma.workout.findUniqueOrThrow.mockResolvedValue({
      status: WorkoutStatus.PENDING,
    } as never);

    const result = await service.updateActuals('user-1', 'set-1', {
      actualReps: 8,
      actualWeight: 62.5,
    });

    expect(result.actualWeight).toBe(62.5);
  });
});
