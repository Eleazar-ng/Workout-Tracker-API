import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DeepMockProxy } from 'jest-mock-extended';
import { ProgramsService } from './programs.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createMockPrismaService,
  resetMockPrismaService,
} from '../../test-utils/mock-prisma';
import { Prisma } from 'generated/prisma/client';
import { encodeCursor } from '../../common/utils/cursor-pagination.util';

describe('ProgramsService', () => {
  let service: ProgramsService;
  let prisma: DeepMockProxy<PrismaService>;

  const buildProgramWithExercises = (
    overrides: Record<string, unknown> = {},
  ) => ({
    id: 'program-1',
    userId: 'user-1',
    name: 'Push Day',
    description: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    programExercises: [
      {
        id: 'pe-1',
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
      },
    ],
    ...overrides,
  });

  const validExerciseInput = [
    {
      exerciseId: 'ex-1',
      order: 0,
      setsCount: 3,
      targetReps: 8,
      targetWeight: 60,
    },
  ];

  beforeEach(async () => {
    prisma = createMockPrismaService();
    // Interactive-callback style $transaction (used by update()) — the
    // callback receives a transaction client; passing the SAME mock
    // object back means tx.program.update, tx.programExercise.deleteMany,
    // etc. resolve against whatever we've already configured on `prisma`.
    prisma.$transaction.mockImplementation(
      (fn) => (fn as (tx: unknown) => unknown)(prisma) as never,
    );

    const module = await Test.createTestingModule({
      providers: [
        ProgramsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ProgramsService);
  });

  afterEach(() => {
    resetMockPrismaService(prisma);
  });

  describe('create', () => {
    it('throws BadRequestException when an exerciseId does not exist in the catalog', async () => {
      prisma.exercise.findMany.mockResolvedValue([]); // none found

      await expect(
        service.create('user-1', {
          name: 'Push Day',
          exercises: validExerciseInput,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.program.create).not.toHaveBeenCalled();
    });

    it('lists every missing exerciseId in the error message', async () => {
      prisma.exercise.findMany.mockResolvedValue([]); // none found

      await expect(
        service.create('user-1', {
          name: 'Push Day',
          exercises: [
            {
              exerciseId: 'ex-1',
              order: 0,
              setsCount: 3,
              targetReps: 8,
              targetWeight: 60,
            },
            {
              exerciseId: 'ex-2',
              order: 1,
              setsCount: 3,
              targetReps: 8,
              targetWeight: 60,
            },
          ],
        }),
      ).rejects.toThrow(/ex-1.*ex-2|ex-2.*ex-1/);
    });

    it('dedupes exerciseIds before checking the catalog', async () => {
      prisma.exercise.findMany.mockResolvedValue([{ id: 'ex-1' } as never]);
      prisma.program.create.mockResolvedValue(
        buildProgramWithExercises() as never,
      );

      await service.create('user-1', {
        name: 'Push Day',
        exercises: [
          {
            exerciseId: 'ex-1',
            order: 0,
            setsCount: 3,
            targetReps: 8,
            targetWeight: 60,
          },
          {
            exerciseId: 'ex-1',
            order: 1,
            setsCount: 3,
            targetReps: 10,
            targetWeight: 40,
          },
        ],
      });

      const [[args]] = prisma.exercise.findMany.mock.calls;
      expect((args?.where?.id as { in: string[] })?.in).toEqual(['ex-1']);
    });

    it('creates the program with nested exercises and returns a mapped detail DTO', async () => {
      prisma.exercise.findMany.mockResolvedValue([{ id: 'ex-1' } as never]);
      prisma.program.create.mockResolvedValue(
        buildProgramWithExercises() as never,
      );

      const result = await service.create('user-1', {
        name: 'Push Day',
        exercises: validExerciseInput,
      });

      expect(result.exercises[0].targetWeight).toBe(60); // Decimal -> Number
      expect(typeof result.exercises[0].targetWeight).toBe('number');
      expect(result.name).toBe('Push Day');
    });
  });

  describe('findAll', () => {
    it('scopes the query to the given userId', async () => {
      prisma.program.findMany.mockResolvedValue([]);

      await service.findAll('user-1', { limit: 20 });

      const [[args]] = prisma.program.findMany.mock.calls;
      expect(args?.where).toMatchObject({ userId: 'user-1' });
    });

    it('applies a keyset WHERE clause when a cursor is provided', async () => {
      prisma.program.findMany.mockResolvedValue([]);
      const cursor = encodeCursor(new Date(), 'program-0');

      await service.findAll('user-1', { limit: 20, cursor });

      const [[args]] = prisma.program.findMany.mock.calls;
      expect(args?.where).toHaveProperty('OR');
    });

    it('maps _count.programExercises to exerciseCount', async () => {
      prisma.program.findMany.mockResolvedValue([
        {
          id: 'program-1',
          name: 'Push Day',
          description: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { programExercises: 5 },
        } as never,
      ]);

      const result = await service.findAll('user-1', { limit: 20 });

      expect(result.data[0].exerciseCount).toBe(5);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when no program matches (wrong id or wrong owner)', async () => {
      prisma.program.findFirst.mockResolvedValue(null);

      await expect(service.findOne('user-1', 'program-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('scopes the lookup by BOTH id and userId (ownership enforcement)', async () => {
      prisma.program.findFirst.mockResolvedValue(
        buildProgramWithExercises() as never,
      );

      await service.findOne('user-1', 'program-1');

      const [[args]] = prisma.program.findFirst.mock.calls;
      expect(args?.where).toEqual({ id: 'program-1', userId: 'user-1' });
    });

    it('returns a correctly mapped detail DTO on success', async () => {
      prisma.program.findFirst.mockResolvedValue(
        buildProgramWithExercises() as never,
      );

      const result = await service.findOne('user-1', 'program-1');

      expect(result.id).toBe('program-1');
      expect(result.exercises).toHaveLength(1);
      expect(result.exercises[0].exercise.name).toBe('Bench Press');
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the program does not belong to the user, before touching anything else', async () => {
      prisma.program.findFirst.mockResolvedValue(null); // ownership check fails

      await expect(
        service.update('user-1', 'program-1', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.exercise.findMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('validates exercises exist BEFORE opening the transaction', async () => {
      prisma.program.findFirst.mockResolvedValue({
        id: 'program-1',
      } as never); // ownership OK
      prisma.exercise.findMany.mockResolvedValue([]); // none found -> invalid

      await expect(
        service.update('user-1', 'program-1', {
          exercises: validExerciseInput,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does NOT touch programExercise rows when exercises are omitted from the update', async () => {
      prisma.program.findFirst.mockResolvedValue({
        id: 'program-1',
      } as never);
      prisma.program.update.mockResolvedValue({} as never);
      prisma.program.findUniqueOrThrow.mockResolvedValue(
        buildProgramWithExercises() as never,
      );

      await service.update('user-1', 'program-1', { name: 'New Name' });

      expect(prisma.programExercise.deleteMany).not.toHaveBeenCalled();
      expect(prisma.programExercise.createMany).not.toHaveBeenCalled();
    });

    it('only includes explicitly-provided fields in the update payload (partial update)', async () => {
      prisma.program.findFirst.mockResolvedValue({
        id: 'program-1',
      } as never);
      prisma.program.update.mockResolvedValue({} as never);
      prisma.program.findUniqueOrThrow.mockResolvedValue(
        buildProgramWithExercises() as never,
      );

      await service.update('user-1', 'program-1', { name: 'New Name' });

      const [[args]] = prisma.program.update.mock.calls;
      expect(args?.data).toEqual({ name: 'New Name' });
      expect(args?.data).not.toHaveProperty('description');
    });

    it('performs a full replace (delete all, then create all) when exercises are provided', async () => {
      prisma.program.findFirst.mockResolvedValue({
        id: 'program-1',
      } as never);
      prisma.exercise.findMany.mockResolvedValue([{ id: 'ex-1' } as never]);
      prisma.program.update.mockResolvedValue({} as never);
      prisma.program.findUniqueOrThrow.mockResolvedValue(
        buildProgramWithExercises() as never,
      );

      const callOrder: string[] = [];
      prisma.programExercise.deleteMany.mockImplementation((async () => {
        callOrder.push('delete');
        return { count: 1 };
      }) as never);
      prisma.programExercise.createMany.mockImplementation((async () => {
        callOrder.push('create');
        return { count: 1 };
      }) as never);

      await service.update('user-1', 'program-1', {
        exercises: validExerciseInput,
      });

      expect(callOrder).toEqual(['delete', 'create']);
      const [[deleteArgs]] = prisma.programExercise.deleteMany.mock.calls;
      expect(deleteArgs).toEqual({ where: { programId: 'program-1' } });
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when the program does not belong to the user', async () => {
      prisma.program.findFirst.mockResolvedValue(null);

      await expect(service.remove('user-1', 'program-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.program.delete).not.toHaveBeenCalled();
    });

    it('deletes successfully when there is no conflict', async () => {
      prisma.program.findFirst.mockResolvedValue({
        id: 'program-1',
      } as never);
      prisma.program.delete.mockResolvedValue({} as never);

      await expect(
        service.remove('user-1', 'program-1'),
      ).resolves.toBeUndefined();
    });

    it('maps a P2003 foreign key violation to a clean ConflictException', async () => {
      prisma.program.findFirst.mockResolvedValue({
        id: 'program-1',
      } as never);
      const fkError = new Prisma.PrismaClientKnownRequestError(
        'FK violation',
        { code: 'P2003', clientVersion: '0.0.0' },
      );
      prisma.program.delete.mockRejectedValue(fkError);

      await expect(service.remove('user-1', 'program-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('rethrows any OTHER error unchanged (does not silently swallow unrelated failures)', async () => {
      prisma.program.findFirst.mockResolvedValue({
        id: 'program-1',
      } as never);
      const unrelatedError = new Error('Something else entirely broke');
      prisma.program.delete.mockRejectedValue(unrelatedError);

      await expect(service.remove('user-1', 'program-1')).rejects.toThrow(
        'Something else entirely broke',
      );
    });
  });
});
