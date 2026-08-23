import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WorkoutStatus } from 'generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CursorPaginationQueryDto } from 'src/common/dto/cursor-pagination-query.dto';
import { FeedQueryDto } from './dto/feed-query.dto';
import { CursorPaginatedResult } from 'src/common/interfaces/cursor-paginated-result.interface';
import { UserSummaryDto } from './dto/user-summary.dto';
import {
  CommentFeedEntryDto,
  FeedEntryDto,
  WorkoutCompletedFeedEntryDto,
} from './dto/feed-entry.dto';
import {
  buildKeysetWhere,
  decodeCursor,
  paginateKeysetResults,
} from '../../common/utils/cursor-pagination.util';

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
    query: CursorPaginationQueryDto,
  ): Promise<CursorPaginatedResult<UserSummaryDto>> {
    const { cursor, limit } = query;

    const keysetWhere = cursor
      ? buildKeysetWhere(
          'createdAt',
          'desc',
          decodeCursor(cursor),
          (v) => new Date(v),
        )
      : {};

    const rows = await this.prisma.follow.findMany({
      where: { followingId: userId, ...keysetWhere },
      take: limit + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        follower: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    const { page, hasMore, nextCursor } = paginateKeysetResults(
      rows,
      limit,
      (row) => row.createdAt,
      (row) => row.id,
    );

    return {
      data: page.map((r) => r.follower),
      meta: { limit, hasMore, nextCursor },
    };
  }

  async getFollowing(
    userId: string,
    query: CursorPaginationQueryDto,
  ): Promise<CursorPaginatedResult<UserSummaryDto>> {
    const { cursor, limit } = query;

    const keysetWhere = cursor
      ? buildKeysetWhere(
          'createdAt',
          'desc',
          decodeCursor(cursor),
          (v) => new Date(v),
        )
      : {};

    const rows = await this.prisma.follow.findMany({
      where: { followerId: userId, ...keysetWhere },
      take: limit + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        following: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    const { page, hasMore, nextCursor } = paginateKeysetResults(
      rows,
      limit,
      (row) => row.createdAt,
      (row) => row.id,
    );

    return {
      data: page.map((r) => r.following),
      meta: { limit, hasMore, nextCursor },
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
  // CURSOR DESIGN (Stage 11 — replaces Stage 9's approximate offset-based
  // approach): merging two independently-sorted, heterogeneous sources
  // (Workouts, Comments) into one correctly-paginated stream reuses the
  // EXACT SAME (value, id) cursor shape as every other endpoint. This
  // works because every row's `id` is a UUID, globally unique across
  // every table — there's no risk of a Workout id colliding with a
  // Comment id. So the SAME decoded cursor boundary can be applied to
  // BOTH source queries independently, and the merged results can be fed
  // through the SAME paginateKeysetResults helper used everywhere else.
  //
  // Correctness: fetching `limit + 1` from EACH source before merging is
  // always sufficient to correctly determine the true top-`limit` merged
  // page, regardless of how skewed the split is between sources — a
  // `limit`-sized page can contain at most `limit` items from either
  // source, so over-fetching `limit + 1` from each guarantees neither
  // source is starved of candidates. This is the standard, provably
  // correct technique for k-way-merge pagination.
  async getFeed(
    userId: string,
    query: FeedQueryDto,
  ): Promise<CursorPaginatedResult<FeedEntryDto>> {
    const { cursor, limit } = query;

    const followedIds = (
      await this.prisma.follow.findMany({
        where: { followerId: userId },
        select: { followingId: true },
      })
    ).map((f) => f.followingId);

    if (followedIds.length === 0) {
      return { data: [], meta: { limit, hasMore: false, nextCursor: null } };
    }

    const decodedCursor = cursor ? decodeCursor(cursor) : null;

    const workoutKeysetWhere = decodedCursor
      ? buildKeysetWhere(
          'completedAt',
          'desc',
          decodedCursor,
          (v) => new Date(v),
        )
      : {};
    const commentKeysetWhere = decodedCursor
      ? buildKeysetWhere('createdAt', 'desc', decodedCursor, (v) => new Date(v))
      : {};

    const [completedWorkouts, comments] = await Promise.all([
      this.prisma.workout.findMany({
        where: {
          userId: { in: followedIds },
          status: WorkoutStatus.COMPLETED,
          ...workoutKeysetWhere,
        },
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
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
        where: { userId: { in: followedIds }, ...commentKeysetWhere },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          workout: { select: { id: true, name: true } },
        },
      }),
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
      (a, b) => {
        const timeDiff = b.occurredAt.getTime() - a.occurredAt.getTime();
        if (timeDiff !== 0) return timeDiff;
        // Same tie-break rule as the shared cursor utility (id desc) —
        // matters for a stable, gapless order when two entries (from
        // either source) share an identical timestamp.
        const aId = a.type === 'WORKOUT_COMPLETED' ? a.workoutId : a.commentId;
        const bId = b.type === 'WORKOUT_COMPLETED' ? b.workoutId : b.commentId;
        return bId.localeCompare(aId);
      },
    );

    const { page, hasMore, nextCursor } = paginateKeysetResults(
      merged,
      limit,
      (entry) => entry.occurredAt,
      (entry) =>
        entry.type === 'WORKOUT_COMPLETED' ? entry.workoutId : entry.commentId,
    );

    return { data: page, meta: { limit, hasMore, nextCursor } };
  }
}
