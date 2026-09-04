import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DeepMockProxy } from 'jest-mock-extended';
import { SocialService } from './social.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createMockPrismaService,
  resetMockPrismaService,
} from '../../test-utils/mock-prisma';
import { Prisma, WorkoutStatus } from 'generated/prisma/client';
import { encodeCursor } from '../../common/utils/cursor-pagination.util';

describe('SocialService', () => {
  let service: SocialService;
  let prisma: DeepMockProxy<PrismaService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module = await Test.createTestingModule({
      providers: [
        SocialService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(SocialService);
  });

  afterEach(() => {
    resetMockPrismaService(prisma);
  });

  // --- follow / unfollow ---------------------------------------------------

  describe('follow', () => {
    it('throws BadRequestException on self-follow BEFORE ever touching the database', async () => {
      await expect(service.follow('user-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.follow.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the target user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.follow('user-1', 'user-2')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.follow.create).not.toHaveBeenCalled();
    });

    it('creates the follow relationship on success', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-2' } as never);
      prisma.follow.create.mockResolvedValue({} as never);

      await service.follow('user-1', 'user-2');

      expect(prisma.follow.create).toHaveBeenCalledWith({
        data: { followerId: 'user-1', followingId: 'user-2' },
      });
    });

    it('maps a P2002 unique-constraint violation to ConflictException ("already following")', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-2' } as never);
      prisma.follow.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique violation', {
          code: 'P2002',
          clientVersion: '0.0.0',
        }),
      );

      await expect(service.follow('user-1', 'user-2')).rejects.toThrow(
        ConflictException,
      );
    });

    it('rethrows unrelated errors unchanged', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-2' } as never);
      prisma.follow.create.mockRejectedValue(
        new Error('Unexpected DB error'),
      );

      await expect(service.follow('user-1', 'user-2')).rejects.toThrow(
        'Unexpected DB error',
      );
    });
  });

  describe('unfollow', () => {
    it('resolves successfully when the follow relationship existed', async () => {
      prisma.follow.delete.mockResolvedValue({} as never);

      await expect(
        service.unfollow('user-1', 'user-2'),
      ).resolves.toBeUndefined();
    });

    it('maps a P2025 not-found error to NotFoundException ("not following")', async () => {
      prisma.follow.delete.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: '0.0.0',
        }),
      );

      await expect(service.unfollow('user-1', 'user-2')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rethrows unrelated errors unchanged', async () => {
      prisma.follow.delete.mockRejectedValue(
        new Error('Unexpected DB error'),
      );

      await expect(service.unfollow('user-1', 'user-2')).rejects.toThrow(
        'Unexpected DB error',
      );
    });
  });

  // --- followers / following -----------------------------------------------

  describe('getFollowers', () => {
    it('scopes by followingId and maps rows to the follower user', async () => {
      prisma.follow.findMany.mockResolvedValue([
        {
          id: 'f1',
          createdAt: new Date(),
          follower: { id: 'user-2', firstName: 'A', lastName: 'B' },
        },
      ] as never);

      const result = await service.getFollowers('user-1', { limit: 20 });

      const [[args]] = prisma.follow.findMany.mock.calls;
      expect(args?.where).toMatchObject({ followingId: 'user-1' });
      expect(result.data).toEqual([
        { id: 'user-2', firstName: 'A', lastName: 'B' },
      ]);
    });

    it('applies a keyset WHERE clause when a cursor is provided', async () => {
      prisma.follow.findMany.mockResolvedValue([]);
      const cursor = encodeCursor(new Date(), 'follow-0');

      await service.getFollowers('user-1', { limit: 20, cursor });

      const [[args]] = prisma.follow.findMany.mock.calls;
      expect(args?.where).toHaveProperty('OR');
    });
  });

  describe('getFollowing', () => {
    it('scopes by followerId and maps rows to the following user', async () => {
      prisma.follow.findMany.mockResolvedValue([
        {
          id: 'f1',
          createdAt: new Date(),
          following: { id: 'user-2', firstName: 'A', lastName: 'B' },
        },
      ] as never);

      const result = await service.getFollowing('user-1', { limit: 20 });

      const [[args]] = prisma.follow.findMany.mock.calls;
      expect(args?.where).toMatchObject({ followerId: 'user-1' });
      expect(result.data).toEqual([
        { id: 'user-2', firstName: 'A', lastName: 'B' },
      ]);
    });
  });

  // --- activity feed -------------------------------------------------------

  describe('getFeed', () => {
    it('returns an empty result immediately when the user follows nobody', async () => {
      prisma.follow.findMany.mockResolvedValue([]);

      const result = await service.getFeed('user-1', { limit: 20 });

      expect(result).toEqual({
        data: [],
        meta: { limit: 20, hasMore: false, nextCursor: null },
      });
      expect(prisma.workout.findMany).not.toHaveBeenCalled();
      expect(prisma.comment.findMany).not.toHaveBeenCalled();
    });

    it('merges workout-completed and comment entries, sorted by occurredAt descending', async () => {
      prisma.follow.findMany.mockResolvedValue([
        { followingId: 'user-2' },
      ] as never);
      prisma.workout.findMany.mockResolvedValue([
        {
          id: 'workout-1',
          name: 'Push Day',
          completedAt: new Date('2026-02-01T10:00:00.000Z'), // older
          user: { id: 'user-2', firstName: 'A', lastName: 'B' },
          workoutExercises: [],
        },
      ] as never);
      prisma.comment.findMany.mockResolvedValue([
        {
          id: 'comment-1',
          content: 'Nice work',
          createdAt: new Date('2026-02-02T10:00:00.000Z'), // newer
          user: { id: 'user-2', firstName: 'A', lastName: 'B' },
          workout: { id: 'workout-1', name: 'Push Day' },
        },
      ] as never);

      const result = await service.getFeed('user-1', { limit: 20 });

      expect(result.data).toHaveLength(2);
      expect(result.data[0].type).toBe('COMMENT'); // newer, comes first
      expect(result.data[1].type).toBe('WORKOUT_COMPLETED');
    });

    it('breaks ties between identical timestamps from different sources by id (descending)', async () => {
      const sameInstant = new Date('2026-02-01T10:00:00.000Z');
      prisma.follow.findMany.mockResolvedValue([
        { followingId: 'user-2' },
      ] as never);
      prisma.workout.findMany.mockResolvedValue([
        {
          id: 'aaa-workout',
          name: 'Push Day',
          completedAt: sameInstant,
          user: { id: 'user-2', firstName: 'A', lastName: 'B' },
          workoutExercises: [],
        },
      ] as never);
      prisma.comment.findMany.mockResolvedValue([
        {
          id: 'zzz-comment',
          content: 'Nice work',
          createdAt: sameInstant,
          user: { id: 'user-2', firstName: 'A', lastName: 'B' },
          workout: { id: 'workout-1', name: 'Push Day' },
        },
      ] as never);

      const result = await service.getFeed('user-1', { limit: 20 });

      // 'zzz-comment' > 'aaa-workout' lexicographically, and the tie-break
      // is DESCENDING by id, so the comment entry must come first.
      expect(result.data[0].type).toBe('COMMENT');
    });

    it('computes exerciseCount, totalSetsPerformed, and totalVolume correctly for a workout entry', async () => {
      prisma.follow.findMany.mockResolvedValue([
        { followingId: 'user-2' },
      ] as never);
      prisma.workout.findMany.mockResolvedValue([
        {
          id: 'workout-1',
          name: 'Push Day',
          completedAt: new Date(),
          user: { id: 'user-2', firstName: 'A', lastName: 'B' },
          workoutExercises: [
            {
              sets: [
                { actualReps: 8, actualWeight: 60 }, // performed, weighted
                { actualReps: 10, actualWeight: null }, // performed, bodyweight
                { actualReps: null, actualWeight: null }, // not performed
              ],
            },
          ],
        },
      ] as never);
      prisma.comment.findMany.mockResolvedValue([]);

      const result = await service.getFeed('user-1', { limit: 20 });

      const entry = result.data[0];
      if (entry.type !== 'WORKOUT_COMPLETED') throw new Error('wrong type');
      expect(entry.exerciseCount).toBe(1);
      expect(entry.totalSetsPerformed).toBe(2); // excludes the null-reps set
      expect(entry.totalVolume).toBe(8 * 60); // excludes the bodyweight set
    });

    it('maps comment entries correctly, including the nested workout context', async () => {
      prisma.follow.findMany.mockResolvedValue([
        { followingId: 'user-2' },
      ] as never);
      prisma.workout.findMany.mockResolvedValue([]);
      prisma.comment.findMany.mockResolvedValue([
        {
          id: 'comment-1',
          content: 'Great session',
          createdAt: new Date('2026-02-01T10:00:00.000Z'),
          user: { id: 'user-2', firstName: 'A', lastName: 'B' },
          workout: { id: 'workout-1', name: 'Push Day' },
        },
      ] as never);

      const result = await service.getFeed('user-1', { limit: 20 });

      expect(result.data[0]).toMatchObject({
        type: 'COMMENT',
        commentId: 'comment-1',
        content: 'Great session',
        workoutId: 'workout-1',
        workoutName: 'Push Day',
      });
    });

    it('applies the same decoded cursor boundary to BOTH the workout and comment queries', async () => {
      const cursor = encodeCursor(
        new Date('2026-01-01T00:00:00.000Z'),
        'x1',
      );
      prisma.follow.findMany.mockResolvedValue([
        { followingId: 'user-2' },
      ] as never);
      prisma.workout.findMany.mockResolvedValue([]);
      prisma.comment.findMany.mockResolvedValue([]);

      await service.getFeed('user-1', { limit: 20, cursor });

      const [[workoutArgs]] = prisma.workout.findMany.mock.calls;
      const [[commentArgs]] = prisma.comment.findMany.mock.calls;
      expect(workoutArgs?.where).toHaveProperty('OR');
      expect(commentArgs?.where).toHaveProperty('OR');
    });

    it('scopes both queries to COMPLETED workouts / comments from followed users only', async () => {
      prisma.follow.findMany.mockResolvedValue([
        { followingId: 'user-2' },
        { followingId: 'user-3' },
      ] as never);
      prisma.workout.findMany.mockResolvedValue([]);
      prisma.comment.findMany.mockResolvedValue([]);

      await service.getFeed('user-1', { limit: 20 });

      const [[workoutArgs]] = prisma.workout.findMany.mock.calls;
      expect(workoutArgs?.where).toMatchObject({
        userId: { in: ['user-2', 'user-3'] },
        status: WorkoutStatus.COMPLETED,
      });

      const [[commentArgs]] = prisma.comment.findMany.mock.calls;
      expect(commentArgs?.where).toMatchObject({
        userId: { in: ['user-2', 'user-3'] },
      });
    });

    it('correctly determines hasMore across the MERGED set, not either source alone', async () => {
      prisma.follow.findMany.mockResolvedValue([
        { followingId: 'user-2' },
      ] as never);
      // 2 workouts (over limit+1=2 for a limit of 1) and 0 comments —
      // total merged candidates exceed the requested page size.
      prisma.workout.findMany.mockResolvedValue([
        {
          id: 'w1',
          name: 'Push Day',
          completedAt: new Date('2026-02-02T00:00:00.000Z'),
          user: { id: 'user-2', firstName: 'A', lastName: 'B' },
          workoutExercises: [],
        },
        {
          id: 'w2',
          name: 'Pull Day',
          completedAt: new Date('2026-02-01T00:00:00.000Z'),
          user: { id: 'user-2', firstName: 'A', lastName: 'B' },
          workoutExercises: [],
        },
      ] as never);
      prisma.comment.findMany.mockResolvedValue([]);

      const result = await service.getFeed('user-1', { limit: 1 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.hasMore).toBe(true);
      expect(result.meta.nextCursor).not.toBeNull();
    });
  });
});
