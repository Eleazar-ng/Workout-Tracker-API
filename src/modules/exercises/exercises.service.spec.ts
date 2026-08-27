import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DeepMockProxy } from 'jest-mock-extended';
import { ExercisesService } from './exercises.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createMockPrismaService,
  resetMockPrismaService,
} from '../../test-utils/mock-prisma';
import { Exercise, ExerciseCategory, MuscleGroup } from 'generated/prisma/client';
import { encodeCursor } from '../../common/utils/cursor-pagination.util';

describe('ExercisesService', () => {
  let service: ExercisesService;
  let prisma: DeepMockProxy<PrismaService>;

  const buildExercise = (overrides: Partial<Exercise> = {}): Exercise =>
    ({
      id: 'ex-1',
      name: 'Bench Press',
      description: 'A compound chest exercise',
      category: ExerciseCategory.STRENGTH,
      muscleGroup: MuscleGroup.CHEST,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as Exercise;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module = await Test.createTestingModule({
      providers: [
        ExercisesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ExercisesService);
  });

  afterEach(() => {
    resetMockPrismaService(prisma);
  });

  describe('findAll', () => {
    it('queries with no filters when none are provided', async () => {
      prisma.exercise.findMany.mockResolvedValue([buildExercise()]);

      await service.findAll({ limit: 20 });

      const [[args]] = prisma.exercise.findMany.mock.calls;
      expect(args?.where).toEqual({});
    });

    it('includes a category filter when provided', async () => {
      prisma.exercise.findMany.mockResolvedValue([]);

      await service.findAll({
        limit: 20,
        category: ExerciseCategory.CARDIO,
      });

      const [[args]] = prisma.exercise.findMany.mock.calls;
      expect(args?.where).toMatchObject({
        category: ExerciseCategory.CARDIO,
      });
    });

    it('includes a muscleGroup filter when provided', async () => {
      prisma.exercise.findMany.mockResolvedValue([]);

      await service.findAll({ limit: 20, muscleGroup: MuscleGroup.BACK });

      const [[args]] = prisma.exercise.findMany.mock.calls;
      expect(args?.where).toMatchObject({ muscleGroup: MuscleGroup.BACK });
    });

    it('combines category and muscleGroup filters when both are provided', async () => {
      prisma.exercise.findMany.mockResolvedValue([]);

      await service.findAll({
        limit: 20,
        category: ExerciseCategory.STRENGTH,
        muscleGroup: MuscleGroup.QUADS,
      });

      const [[args]] = prisma.exercise.findMany.mock.calls;
      expect(args?.where).toMatchObject({
        category: ExerciseCategory.STRENGTH,
        muscleGroup: MuscleGroup.QUADS,
      });
    });

    it('applies a keyset WHERE clause when a cursor is provided', async () => {
      prisma.exercise.findMany.mockResolvedValue([]);
      const cursor = encodeCursor('Bench Press', 'ex-1');

      await service.findAll({ limit: 20, cursor });

      const [[args]] = prisma.exercise.findMany.mock.calls;
      expect(args?.where).toHaveProperty('OR');
    });

    it('requests limit + 1 rows to determine hasMore', async () => {
      prisma.exercise.findMany.mockResolvedValue([]);

      await service.findAll({ limit: 10 });

      const [[args]] = prisma.exercise.findMany.mock.calls;
      expect(args?.take).toBe(11);
    });

    it('sorts by name then id, both ascending', async () => {
      prisma.exercise.findMany.mockResolvedValue([]);

      await service.findAll({ limit: 20 });

      const [[args]] = prisma.exercise.findMany.mock.calls;
      expect(args?.orderBy).toEqual([{ name: 'asc' }, { id: 'asc' }]);
    });

    it('returns hasMore=false and no nextCursor when results fit within the limit', async () => {
      prisma.exercise.findMany.mockResolvedValue([buildExercise()]);

      const result = await service.findAll({ limit: 20 });

      expect(result.meta.hasMore).toBe(false);
      expect(result.meta.nextCursor).toBeNull();
      expect(result.data).toHaveLength(1);
    });

    it('returns hasMore=true and trims the extra row when more results exist', async () => {
      const rows = [
        buildExercise({ id: 'ex-1', name: 'A' }),
        buildExercise({ id: 'ex-2', name: 'B' }),
      ];
      prisma.exercise.findMany.mockResolvedValue(rows);

      const result = await service.findAll({ limit: 1 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.hasMore).toBe(true);
      expect(result.meta.nextCursor).not.toBeNull();
    });
  });

  describe('findOne', () => {
    it('returns the exercise when found', async () => {
      const exercise = buildExercise();
      prisma.exercise.findUnique.mockResolvedValue(exercise);

      const result = await service.findOne('ex-1');

      expect(result).toBe(exercise);
    });

    it('throws NotFoundException when no exercise matches the id', async () => {
      prisma.exercise.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
