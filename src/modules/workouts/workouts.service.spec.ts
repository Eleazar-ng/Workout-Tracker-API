import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DeepMockProxy } from 'jest-mock-extended';
import { WorkoutsService } from './workouts.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createMockPrismaService,
  resetMockPrismaService,
} from '../../test-utils/mock-prisma';
import { Workout,WorkoutStatus } from 'generated/prisma/client';
import { encodeCursor } from '../../common/utils/cursor-pagination.util';

describe('WorkoutsService', () => {
  let service: WorkoutsService;
  let prisma: DeepMockProxy<PrismaService>;

  const buildProgram = (overrides: Record<string, unknown> = {}) => ({
    id: 'program-1',
    userId: 'user-1',
    name: 'Push Day',
    programExercises: [
      {
        order: 0,
        setsCount: 3,
        targetReps: 8,
        targetWeight: 60,
        exerciseId: 'ex-1',
      },
    ],
    ...overrides,
  });

  const buildWorkout = (overrides: Partial<Workout> = {}): Workout =>
    ({
      id: 'workout-1',
      userId: 'user-1',
      programId: 'program-1',
      name: 'Push Day',
      scheduledAt: new Date('2026-02-01T10:00:00.000Z'),
      status: WorkoutStatus.PENDING,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as Workout;

  const buildWorkoutWithDetail = (
    overrides: Record<string, unknown> = {},
  ) => ({
    ...buildWorkout(),
    workoutExercises: [
      {
        id: 'we-1',
        order: 0,
        setsCount: 3,
        targetReps: 8,
        targetWeight: 60,
        exercise: {
          id: 'ex-1',
          name: 'Bench Press',
          category: 'STRENGTH',
          muscleGroup: 'CHEST',
        },
        sets: [
          {
            id: 'set-1',
            setNumber: 1,
            targetReps: 8,
            targetWeight: 60,
            actualReps: null,
            actualWeight: null,
            completedAt: null,
          },
        ],
      },
    ],
    comments: [],
    ...overrides,
  });

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module = await Test.createTestingModule({
      providers: [
        WorkoutsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(WorkoutsService);
  });

  afterEach(() => {
    resetMockPrismaService(prisma);
  });

  describe('create (the freeze)', () => {
    it('throws NotFoundException when the program does not belong to the user', async () => {
      prisma.program.findFirst.mockResolvedValue(null);

      await expect(
        service.create('user-1', {
          programId: 'program-1',
          scheduledAt: '2026-02-01T10:00:00.000Z',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.workout.create).not.toHaveBeenCalled();
    });

    it('copies the program name onto the workout', async () => {
      prisma.program.findFirst.mockResolvedValue(buildProgram() as never);
      prisma.workout.create.mockResolvedValue(
        buildWorkoutWithDetail() as never,
      );

      await service.create('user-1', {
        programId: 'program-1',
        scheduledAt: '2026-02-01T10:00:00.000Z',
      });

      const [[args]] = prisma.workout.create.mock.calls;
      expect((args.data as { name: string }).name).toBe('Push Day');
    });

    it('freezes each ProgramExercise into a WorkoutExercise with matching targets', async () => {
      prisma.program.findFirst.mockResolvedValue(buildProgram() as never);
      prisma.workout.create.mockResolvedValue(
        buildWorkoutWithDetail() as never,
      );

      await service.create('user-1', {
        programId: 'program-1',
        scheduledAt: '2026-02-01T10:00:00.000Z',
      });

      const [[args]] = prisma.workout.create.mock.calls;
      const workoutExercises = (
        args.data as {
          workoutExercises: { create: Array<Record<string, unknown>> };
        }
      ).workoutExercises.create;

      expect(workoutExercises).toHaveLength(1);
      expect(workoutExercises[0]).toMatchObject({
        order: 0,
        setsCount: 3,
        targetReps: 8,
        targetWeight: 60,
        exerciseId: 'ex-1',
      });
    });

    it('generates exactly setsCount Set rows per exercise, numbered 1..N, with target values frozen and actuals null', async () => {
      prisma.program.findFirst.mockResolvedValue(buildProgram() as never);
      prisma.workout.create.mockResolvedValue(
        buildWorkoutWithDetail() as never,
      );

      await service.create('user-1', {
        programId: 'program-1',
        scheduledAt: '2026-02-01T10:00:00.000Z',
      });

      const [[args]] = prisma.workout.create.mock.calls;
      const workoutExercises = (
        args.data as {
          workoutExercises: {
            create: Array<{
              sets: { create: Array<Record<string, unknown>> };
            }>;
          };
        }
      ).workoutExercises.create;
      const sets = workoutExercises[0].sets.create;

      expect(sets).toHaveLength(3); // matches setsCount: 3
      expect(sets.map((s) => s.setNumber)).toEqual([1, 2, 3]);
      sets.forEach((s) => {
        expect(s.targetReps).toBe(8);
        expect(s.targetWeight).toBe(60);
        // Actuals are never included at creation time — they default to
        // null via the schema, not set explicitly here.
        expect(s).not.toHaveProperty('actualReps');
        expect(s).not.toHaveProperty('actualWeight');
      });
    });

    it('freezes multiple exercises independently, each with its own setsCount', async () => {
      prisma.program.findFirst.mockResolvedValue(
        buildProgram({
          programExercises: [
            {
              order: 0,
              setsCount: 2,
              targetReps: 8,
              targetWeight: 60,
              exerciseId: 'ex-1',
            },
            {
              order: 1,
              setsCount: 4,
              targetReps: 12,
              targetWeight: 20,
              exerciseId: 'ex-2',
            },
          ],
        }) as never,
      );
      prisma.workout.create.mockResolvedValue(
        buildWorkoutWithDetail() as never,
      );

      await service.create('user-1', {
        programId: 'program-1',
        scheduledAt: '2026-02-01T10:00:00.000Z',
      });

      const [[args]] = prisma.workout.create.mock.calls;
      const workoutExercises = (
        args.data as {
          workoutExercises: {
            create: Array<{ sets: { create: unknown[] } }>;
          };
        }
      ).workoutExercises.create;

      expect(workoutExercises[0].sets.create).toHaveLength(2);
      expect(workoutExercises[1].sets.create).toHaveLength(4);
    });
  });

  describe('findAll', () => {
    it('scopes by userId and applies the status filter when provided', async () => {
      prisma.workout.findMany.mockResolvedValue([]);

      await service.findAll('user-1', {
        limit: 20,
        status: WorkoutStatus.COMPLETED,
      });

      const [[args]] = prisma.workout.findMany.mock.calls;
      expect(args?.where).toMatchObject({
        userId: 'user-1',
        status: WorkoutStatus.COMPLETED,
      });
    });

    it('sorts ascending by scheduledAt then id (soonest-first)', async () => {
      prisma.workout.findMany.mockResolvedValue([]);

      await service.findAll('user-1', { limit: 20 });

      const [[args]] = prisma.workout.findMany.mock.calls;
      expect(args?.orderBy).toEqual([{ scheduledAt: 'asc' }, { id: 'asc' }]);
    });

    it('applies a keyset WHERE clause and maps results correctly when a cursor and real rows are provided', async () => {
      const cursor = encodeCursor(new Date('2026-01-01T00:00:00.000Z'), 'w0');
      prisma.workout.findMany.mockResolvedValue([
        {
          id: 'workout-1',
          name: 'Push Day',
          scheduledAt: new Date('2026-02-01T10:00:00.000Z'),
          status: WorkoutStatus.PENDING,
          completedAt: null,
          createdAt: new Date(),
          _count: { workoutExercises: 3 },
        } as never,
      ]);

      const result = await service.findAll('user-1', { limit: 20, cursor });

      const [[args]] = prisma.workout.findMany.mock.calls;
      expect(args?.where).toHaveProperty('OR');
      expect(result.data[0]).toMatchObject({
        id: 'workout-1',
        exerciseCount: 3,
      });
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when not found or not owned', async () => {
      prisma.workout.findFirst.mockResolvedValue(null);

      await expect(service.findOne('user-1', 'workout-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('maps Decimal-like target/actual weight fields to numbers, including a null actualWeight', async () => {
      prisma.workout.findFirst.mockResolvedValue(
        buildWorkoutWithDetail() as never,
      );

      const result = await service.findOne('user-1', 'workout-1');

      const set = result.exercises[0].sets[0];
      expect(typeof result.exercises[0].targetWeight).toBe('number');
      expect(typeof set.targetWeight).toBe('number');
      expect(set.actualWeight).toBeNull();
    });

    it('preserves a non-null actualWeight as a number', async () => {
      prisma.workout.findFirst.mockResolvedValue(
        buildWorkoutWithDetail({
          workoutExercises: [
            {
              id: 'we-1',
              order: 0,
              setsCount: 1,
              targetReps: 8,
              targetWeight: 60,
              exercise: {
                id: 'ex-1',
                name: 'Bench Press',
                category: 'STRENGTH',
                muscleGroup: 'CHEST',
              },
              sets: [
                {
                  id: 'set-1',
                  setNumber: 1,
                  targetReps: 8,
                  targetWeight: 60,
                  actualReps: 8,
                  actualWeight: 62.5,
                  completedAt: new Date(),
                },
              ],
            },
          ],
        }) as never,
      );

      const result = await service.findOne('user-1', 'workout-1');

      expect(result.exercises[0].sets[0].actualWeight).toBe(62.5);
    });

    it('maps comments correctly when the workout has them', async () => {
      const commentDate = new Date('2026-02-01T12:00:00.000Z');
      prisma.workout.findFirst.mockResolvedValue(
        buildWorkoutWithDetail({
          comments: [
            {
              id: 'comment-1',
              content: 'Felt strong today',
              createdAt: commentDate,
              userId: 'user-1',
            },
          ],
        }) as never,
      );

      const result = await service.findOne('user-1', 'workout-1');

      expect(result.comments).toEqual([
        {
          id: 'comment-1',
          content: 'Felt strong today',
          createdAt: commentDate,
          userId: 'user-1',
        },
      ]);
    });
  });

  describe('update', () => {
    it('throws NotFoundException when not owned', async () => {
      prisma.workout.findFirst.mockResolvedValue(null);

      await expect(
        service.update('user-1', 'workout-1', { status: 'SKIPPED' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the workout is COMPLETED (locked)', async () => {
      prisma.workout.findFirst.mockResolvedValue(
        buildWorkout({ status: WorkoutStatus.COMPLETED }),
      );

      await expect(
        service.update('user-1', 'workout-1', { status: 'SKIPPED' }),
      ).rejects.toThrow(ConflictException);

      expect(prisma.workout.update).not.toHaveBeenCalled();
    });

    it('only includes explicitly-provided fields in the update payload', async () => {
      prisma.workout.findFirst.mockResolvedValue(
        buildWorkout({ status: WorkoutStatus.PENDING }),
      );
      prisma.workout.update.mockResolvedValue(
        buildWorkoutWithDetail() as never,
      );

      await service.update('user-1', 'workout-1', { status: 'SKIPPED' });

      const [[args]] = prisma.workout.update.mock.calls;
      expect(args?.data).toEqual({ status: 'SKIPPED' });
      expect(args?.data).not.toHaveProperty('scheduledAt');
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when not owned', async () => {
      prisma.workout.findFirst.mockResolvedValue(null);

      await expect(service.remove('user-1', 'workout-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.workout.delete).not.toHaveBeenCalled();
    });

    it('deletes when owned', async () => {
      prisma.workout.findFirst.mockResolvedValue(buildWorkout());
      prisma.workout.delete.mockResolvedValue({} as never);

      await expect(
        service.remove('user-1', 'workout-1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('addExercise', () => {
    it('throws ConflictException when the workout is locked (COMPLETED)', async () => {
      prisma.workout.findFirst.mockResolvedValue(
        buildWorkout({ status: WorkoutStatus.COMPLETED }),
      );

      await expect(
        service.addExercise('user-1', 'workout-1', {
          exerciseId: 'ex-2',
          order: 1,
          setsCount: 3,
          targetReps: 10,
          targetWeight: 40,
        }),
      ).rejects.toThrow(ConflictException);

      expect(prisma.workoutExercise.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the exercise does not exist in the catalog', async () => {
      prisma.workout.findFirst.mockResolvedValue(
        buildWorkout({ status: WorkoutStatus.PENDING }),
      );
      prisma.exercise.findUnique.mockResolvedValue(null);

      await expect(
        service.addExercise('user-1', 'workout-1', {
          exerciseId: 'nonexistent',
          order: 1,
          setsCount: 3,
          targetReps: 10,
          targetWeight: 40,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates the WorkoutExercise with the correct number of frozen Sets', async () => {
      prisma.workout.findFirst
        .mockResolvedValueOnce(
          buildWorkout({ status: WorkoutStatus.PENDING }),
        )
        .mockResolvedValueOnce(buildWorkoutWithDetail() as never); // for the trailing findOne()
      prisma.exercise.findUnique.mockResolvedValue({ id: 'ex-2' } as never);
      prisma.workoutExercise.create.mockResolvedValue({} as never);

      await service.addExercise('user-1', 'workout-1', {
        exerciseId: 'ex-2',
        order: 1,
        setsCount: 4,
        targetReps: 10,
        targetWeight: 40,
      });

      const [[args]] = prisma.workoutExercise.create.mock.calls;
      const sets = (
        args.data as { sets: { create: Array<Record<string, unknown>> } }
      ).sets.create;
      expect(sets).toHaveLength(4);
      expect(sets.map((s) => s.setNumber)).toEqual([1, 2, 3, 4]);
    });
  });

  describe('removeExercise', () => {
    it('throws ConflictException when the workout is locked', async () => {
      prisma.workout.findFirst.mockResolvedValue(
        buildWorkout({ status: WorkoutStatus.COMPLETED }),
      );

      await expect(
        service.removeExercise('user-1', 'workout-1', 'we-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when the WorkoutExercise does not belong to this workout', async () => {
      prisma.workout.findFirst.mockResolvedValue(
        buildWorkout({ status: WorkoutStatus.PENDING }),
      );
      prisma.workoutExercise.findFirst.mockResolvedValue(null);

      await expect(
        service.removeExercise('user-1', 'workout-1', 'we-999'),
      ).rejects.toThrow(NotFoundException);
    });

    it('does NOT block removal even if its sets already have recorded actuals (coarser action, allowed)', async () => {
      prisma.workout.findFirst.mockResolvedValue(
        buildWorkout({ status: WorkoutStatus.PENDING }),
      );
      prisma.workoutExercise.findFirst.mockResolvedValue({
        id: 'we-1',
      } as never);
      prisma.workoutExercise.delete.mockResolvedValue({} as never);

      await expect(
        service.removeExercise('user-1', 'workout-1', 'we-1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('updateExerciseSetsCount', () => {
    const workoutExercise = {
      id: 'we-1',
      targetReps: 8,
      targetWeight: 60,
    };

    it('throws ConflictException when the workout is locked', async () => {
      prisma.workout.findFirst.mockResolvedValue(
        buildWorkout({ status: WorkoutStatus.COMPLETED }),
      );

      await expect(
        service.updateExerciseSetsCount('user-1', 'workout-1', 'we-1', {
          setsCount: 5,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("GROWING: appends new sets continuing the setNumber sequence with the exercise's frozen targets", async () => {
      prisma.workout.findFirst
        .mockResolvedValueOnce(
          buildWorkout({ status: WorkoutStatus.PENDING }),
        )
        .mockResolvedValueOnce(buildWorkoutWithDetail() as never);
      prisma.workoutExercise.findFirst.mockResolvedValue(
        workoutExercise as never,
      );
      prisma.set.findMany.mockResolvedValue([
        { id: 's1', setNumber: 1, actualReps: null, actualWeight: null },
        { id: 's2', setNumber: 2, actualReps: null, actualWeight: null },
      ] as never);
      prisma.set.createMany.mockResolvedValue({ count: 2 } as never);
      prisma.workoutExercise.update.mockResolvedValue({} as never);

      await service.updateExerciseSetsCount('user-1', 'workout-1', 'we-1', {
        setsCount: 4,
      });

      const [[args]] = prisma.set.createMany.mock.calls;
      const created = args?.data as Array<Record<string, unknown>>;
      expect(created).toHaveLength(2); // 4 - 2 existing
      expect(created.map((s) => s.setNumber)).toEqual([3, 4]);
      created.forEach((s) => {
        expect(s.targetReps).toBe(8);
        expect(s.targetWeight).toBe(60);
      });
      expect(prisma.set.deleteMany).not.toHaveBeenCalled();
    });

    it('SHRINKING: removes the highest-numbered sets first when none have recorded actuals', async () => {
      prisma.workout.findFirst
        .mockResolvedValueOnce(
          buildWorkout({ status: WorkoutStatus.PENDING }),
        )
        .mockResolvedValueOnce(buildWorkoutWithDetail() as never);
      prisma.workoutExercise.findFirst.mockResolvedValue(
        workoutExercise as never,
      );
      prisma.set.findMany.mockResolvedValue([
        { id: 's1', setNumber: 1, actualReps: null, actualWeight: null },
        { id: 's2', setNumber: 2, actualReps: null, actualWeight: null },
        { id: 's3', setNumber: 3, actualReps: null, actualWeight: null },
      ] as never);
      prisma.set.deleteMany.mockResolvedValue({ count: 1 } as never);
      prisma.workoutExercise.update.mockResolvedValue({} as never);

      await service.updateExerciseSetsCount('user-1', 'workout-1', 'we-1', {
        setsCount: 2,
      });

      const [[args]] = prisma.set.deleteMany.mock.calls;
      expect((args?.where?.id as { in: string[] })?.in).toEqual(['s3']);
      expect(prisma.set.createMany).not.toHaveBeenCalled();
    });

    it('SHRINKING: throws ConflictException when a set-to-be-removed has a recorded actualReps', async () => {
      prisma.workout.findFirst.mockResolvedValue(
        buildWorkout({ status: WorkoutStatus.PENDING }),
      );
      prisma.workoutExercise.findFirst.mockResolvedValue(
        workoutExercise as never,
      );
      prisma.set.findMany.mockResolvedValue([
        { id: 's1', setNumber: 1, actualReps: null, actualWeight: null },
        { id: 's2', setNumber: 2, actualReps: 8, actualWeight: null }, // recorded!
      ] as never);

      await expect(
        service.updateExerciseSetsCount('user-1', 'workout-1', 'we-1', {
          setsCount: 1,
        }),
      ).rejects.toThrow(ConflictException);

      expect(prisma.set.deleteMany).not.toHaveBeenCalled();
    });

    it('SHRINKING: throws ConflictException when a set-to-be-removed has a recorded actualWeight (even with null reps)', async () => {
      prisma.workout.findFirst.mockResolvedValue(
        buildWorkout({ status: WorkoutStatus.PENDING }),
      );
      prisma.workoutExercise.findFirst.mockResolvedValue(
        workoutExercise as never,
      );
      prisma.set.findMany.mockResolvedValue([
        { id: 's1', setNumber: 1, actualReps: null, actualWeight: null },
        { id: 's2', setNumber: 2, actualReps: null, actualWeight: 60 }, // recorded!
      ] as never);

      await expect(
        service.updateExerciseSetsCount('user-1', 'workout-1', 'we-1', {
          setsCount: 1,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('always updates the WorkoutExercise.setsCount field regardless of growing/shrinking', async () => {
      prisma.workout.findFirst
        .mockResolvedValueOnce(
          buildWorkout({ status: WorkoutStatus.PENDING }),
        )
        .mockResolvedValueOnce(buildWorkoutWithDetail() as never);
      prisma.workoutExercise.findFirst.mockResolvedValue(
        workoutExercise as never,
      );
      prisma.set.findMany.mockResolvedValue([
        { id: 's1', setNumber: 1, actualReps: null, actualWeight: null },
      ] as never);
      prisma.set.createMany.mockResolvedValue({ count: 1 } as never);
      prisma.workoutExercise.update.mockResolvedValue({} as never);

      await service.updateExerciseSetsCount('user-1', 'workout-1', 'we-1', {
        setsCount: 2,
      });

      expect(prisma.workoutExercise.update).toHaveBeenCalledWith({
        where: { id: 'we-1' },
        data: { setsCount: 2 },
      });
    });
  });

  describe('addComment', () => {
    it('throws NotFoundException when the workout is not owned', async () => {
      prisma.workout.findFirst.mockResolvedValue(null);

      await expect(
        service.addComment('user-1', 'workout-1', {
          content: 'Great session',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('is ALLOWED even when the workout is COMPLETED — the lock does not apply to comments', async () => {
      prisma.workout.findFirst.mockResolvedValue(
        buildWorkout({ status: WorkoutStatus.COMPLETED }),
      );
      prisma.comment.create.mockResolvedValue({
        id: 'comment-1',
        content: 'Great session',
        createdAt: new Date(),
        userId: 'user-1',
      } as never);

      await expect(
        service.addComment('user-1', 'workout-1', {
          content: 'Great session',
        }),
      ).resolves.toMatchObject({ content: 'Great session' });
    });
  });

  describe('recomputeCompletionStatus', () => {
    it('does nothing if the workout no longer exists', async () => {
      prisma.workout.findUnique.mockResolvedValue(null);

      await service.recomputeCompletionStatus('workout-1');

      expect(prisma.set.findMany).not.toHaveBeenCalled();
      expect(prisma.workout.update).not.toHaveBeenCalled();
    });

    it('short-circuits WITHOUT querying sets if the workout is already COMPLETED', async () => {
      prisma.workout.findUnique.mockResolvedValue({
        status: WorkoutStatus.COMPLETED,
      } as never);

      await service.recomputeCompletionStatus('workout-1');

      // The whole point of the terminal-state design: COMPLETED never
      // gets recomputed, and we shouldn't even pay for the sets query.
      expect(prisma.set.findMany).not.toHaveBeenCalled();
      expect(prisma.workout.update).not.toHaveBeenCalled();
    });

    it('does NOT complete a workout with zero sets (vacuous-truth guard)', async () => {
      prisma.workout.findUnique.mockResolvedValue({
        status: WorkoutStatus.PENDING,
      } as never);
      prisma.set.findMany.mockResolvedValue([]);

      await service.recomputeCompletionStatus('workout-1');

      expect(prisma.workout.update).not.toHaveBeenCalled();
    });

    it('does NOT complete when some sets still have null actualReps', async () => {
      prisma.workout.findUnique.mockResolvedValue({
        status: WorkoutStatus.PENDING,
      } as never);
      prisma.set.findMany.mockResolvedValue([
        { actualReps: 8 },
        { actualReps: null },
      ] as never);

      await service.recomputeCompletionStatus('workout-1');

      expect(prisma.workout.update).not.toHaveBeenCalled();
    });

    it('DOES complete when every set has non-null actualReps', async () => {
      prisma.workout.findUnique.mockResolvedValue({
        status: WorkoutStatus.PENDING,
      } as never);
      prisma.set.findMany.mockResolvedValue([
        { actualReps: 8 },
        { actualReps: 10 },
      ] as never);
      prisma.workout.update.mockResolvedValue({} as never);

      await service.recomputeCompletionStatus('workout-1');

      expect(prisma.workout.update).toHaveBeenCalledWith({
        where: { id: 'workout-1' },
        data: {
          status: WorkoutStatus.COMPLETED,
          completedAt: expect.any(Date),
        },
      });
    });

    it('completes correctly even when actualWeight is null on every set — weight never gates completion', async () => {
      prisma.workout.findUnique.mockResolvedValue({
        status: WorkoutStatus.PENDING,
      } as never);
      // Only actualReps is selected/checked by the real query (per the
      // service's `select: { actualReps: true }`), so actualWeight being
      // absent/null here is exactly what a bodyweight-only workout's
      // fetched rows would look like.
      prisma.set.findMany.mockResolvedValue([
        { actualReps: 12 },
        { actualReps: 15 },
      ] as never);
      prisma.workout.update.mockResolvedValue({} as never);

      await service.recomputeCompletionStatus('workout-1');

      expect(prisma.workout.update).toHaveBeenCalledTimes(1);
    });
  });
});
