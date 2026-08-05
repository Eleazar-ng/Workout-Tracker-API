import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WorkoutStatus } from 'generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { FeedQueryDto } from './dto/feed-query.dto';
import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import { UserSummaryDto } from './dto/user-summary.dto';
import {
  CommentFeedEntryDto,
  FeedEntryDto,
  WorkoutCompletedFeedEntryDto,
} from './dto/feed-entry.dto';

@Injectable()
export class SocialService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Follow / unfollow ----------------------------------------------------

  async follow(currentUserId: string, targetUserId: string): Promise<void> {
    // App-layer half of the defense-in-depth self-follow prevention
    // documented in schema.prisma's Follow model and
    // docs/deferred-decisions.md — the DB-level CHECK constraint is the
    // other half (see the migration note delivered alongside this stage).
    if (currentUserId === targetUserId) {
      throw new BadRequestException('You cannot follow yourself');
    }

    const targetExists = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!targetExists) {
      throw new NotFoundException(`User with id "${targetUserId}" not found`);
    }

    try {
      await this.prisma.follow.create({
        data: { followerId: currentUserId, followingId: targetUserId },
      });
    } catch (error) {
      // P2002: unique constraint violation on (followerId, followingId) —
      // already following. Converted to a clean 409 rather than a raw DB
      // error, same pattern as Programs' P2003 handling in Stage 5.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Already following this user');
      }
      throw error;
    }
  }

  async unfollow(currentUserId: string, targetUserId: string): Promise<void> {
    try {
      await this.prisma.follow.delete({
        where: {
          followerId_followingId: {
            followerId: currentUserId,
            followingId: targetUserId,
          },
        },
      });
    } catch (error) {
      // P2025: record to delete does not exist — i.e. wasn't following
      // this user in the first place.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('You are not following this user');
      }
      throw error;
    }
  }

  // --- Followers / following lists -------------------------------------------

  async getFollowers(
    userId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<UserSummaryDto>> {
    const { page, limit } = query;
    const where = { followingId: userId };

    const [rows, total] = await Promise.all([
      this.prisma.follow.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          follower: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.follow.count({ where }),
    ]);

    return {
      data: rows.map((r) => r.follower),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getFollowing(
    userId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<UserSummaryDto>> {
    const { page, limit } = query;
    const where = { followerId: userId };

    const [rows, total] = await Promise.all([
      this.prisma.follow.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          following: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      }),
      this.prisma.follow.count({ where }),
    ]);

    return {
      data: rows.map((r) => r.following),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // --- Activity feed -------------------------------------------------------

  // Computed at query time, not materialized — consistent with the Stage 1
  // decision on the activity feed (see schema.prisma's Social section
  // comment). Feed = completed Workouts + Comments from users the current
  // user follows, EXCLUDING the current user's own activity (a feed is
  // for discovering others, not re-surfacing your own data you already
  // have direct access to via /workouts).
  //
  // Pagination approach: since we're merging two independently-ordered
  // sources (Workouts, Comments) into one chronological stream, we fetch
  // the top (page * limit) most-recent rows from EACH source — enough
  // that, once merged and re-sorted, the requested page's window is
  // guaranteed correct — then slice to the exact page. This is a standard
  // k-way merge approach for heterogeneous feeds. `meta.total` is exact
  // (sum of two independent counts); the fetch-then-merge itself is an
  // acceptable cost at this scale, and a candidate for a materialized
  // feed table later if it ever needs to be optimized (see
  // deferred-decisions.md).
  async getFeed(
    userId: string,
    query: FeedQueryDto,
  ): Promise<PaginatedResult<FeedEntryDto>> {
    const { page, limit } = query;

    const followedIds = (
      await this.prisma.follow.findMany({
        where: { followerId: userId },
        select: { followingId: true },
      })
    ).map((f) => f.followingId);

    if (followedIds.length === 0) {
      return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
    }

    const fetchDepth = page * limit;

    const [completedWorkouts, comments, totalWorkouts, totalComments] =
      await Promise.all([
        this.prisma.workout.findMany({
          where: {
            userId: { in: followedIds },
            status: WorkoutStatus.COMPLETED,
          },
          orderBy: { completedAt: 'desc' },
          take: fetchDepth,
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
            workoutExercises: {
              include: {
                sets: { select: { actualReps: true, actualWeight: true } },
              },
            },
          },
        }),
        this.prisma.comment.findMany({
          where: { userId: { in: followedIds } },
          orderBy: { createdAt: 'desc' },
          take: fetchDepth,
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
            workout: { select: { id: true, name: true } },
          },
        }),
        this.prisma.workout.count({
          where: {
            userId: { in: followedIds },
            status: WorkoutStatus.COMPLETED,
          },
        }),
        this.prisma.comment.count({ where: { userId: { in: followedIds } } }),
      ]);

    const workoutEntries: WorkoutCompletedFeedEntryDto[] =
      completedWorkouts.map((w) => {
        const allSets = w.workoutExercises.flatMap((we) => we.sets);
        const performedSets = allSets.filter((s) => s.actualReps !== null);
        const totalVolume = allSets.reduce(
          (sum, s) =>
            s.actualReps !== null && s.actualWeight !== null
              ? sum + s.actualReps * Number(s.actualWeight)
              : sum,
          0,
        );

        return {
          type: 'WORKOUT_COMPLETED',
          // completedAt is guaranteed non-null here since we filtered to
          // status: COMPLETED, which is only ever set alongside
          // completedAt (see WorkoutsService.recomputeCompletionStatus) —
          // the `!` is safe given that invariant.
          occurredAt: w.completedAt!,
          user: w.user,
          workoutId: w.id,
          workoutName: w.name,
          exerciseCount: w.workoutExercises.length,
          totalSetsPerformed: performedSets.length,
          totalVolume,
        };
      });

    const commentEntries: CommentFeedEntryDto[] = comments.map((c) => ({
      type: 'COMMENT',
      occurredAt: c.createdAt,
      user: c.user,
      commentId: c.id,
      content: c.content,
      workoutId: c.workout.id,
      workoutName: c.workout.name,
    }));

    const merged: FeedEntryDto[] = [...workoutEntries, ...commentEntries].sort(
      (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime(),
    );

    const startIndex = (page - 1) * limit;
    const pageSlice = merged.slice(startIndex, startIndex + limit);

    const total = totalWorkouts + totalComments;

    return {
      data: pageSlice,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }
}
