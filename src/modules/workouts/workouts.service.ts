import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Workout, WorkoutStatus } from 'generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWorkoutDto } from './dto/create-workout.dto';
import { UpdateWorkoutDto } from './dto/update-workout.dto';
import { ListWorkoutsQueryDto } from './dto/list-workouts-query.dto';
import { AddWorkoutExerciseDto } from './dto/add-workout-exercise.dto';
import { UpdateWorkoutExerciseDto } from './dto/update-workout-exercise.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CursorPaginatedResult } from '../../common/interfaces/cursor-paginated-result.interface';
import {
  buildKeysetWhere,
  decodeCursor,
  paginateKeysetResults,
} from '../../common/utils/cursor-pagination.util';
import { WorkoutSummaryResponseDto } from './dto/workout-summary-response.dto';
import {
  CommentDetailDto,
  WorkoutDetailResponseDto,
  WorkoutExerciseDetailDto,
} from './dto/workout-detail-response.dto';

// Reused across findOne/create/update/structural-edit responses so every
// method that returns a full Workout shapes it identically.
const workoutDetailInclude = {
  workoutExercises: {
    include: {
      exercise: true,
      sets: { orderBy: { setNumber: 'asc' } },
    },
    orderBy: { order: 'asc' },
  },
  comments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.WorkoutInclude;

type WorkoutWithDetail = Prisma.WorkoutGetPayload<{
  include: typeof workoutDetailInclude;
}>;

const LOCKED_MESSAGE =
  'This workout is completed and can no longer be modified.';

@Injectable()
export class WorkoutsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    dto: CreateWorkoutDto,
  ): Promise<WorkoutDetailResponseDto> {
    // Ownership check on the PROGRAM (not the workout, which doesn't
    // exist yet) — a user can only build a Workout from their own
    // Program. 404 rather than 403, consistent with every other
    // ownership check in this codebase.
    const program = await this.prisma.program.findFirst({
      where: { id: dto.programId, userId },
      include: { programExercises: true },
    });

    if (!program) {
      throw new NotFoundException(
        `Program with id "${dto.programId}" not found`,
      );
    }

    // THE FREEZE: copy each ProgramExercise's targets into a new
    // WorkoutExercise, and generate `setsCount` individual Set rows per
    // exercise with target values duplicated down and actuals left null.
    // This nested create is a single Prisma statement — atomic by
    // default, no explicit $transaction needed. Per Stage 1's schema
    // design, nothing here references the Program live; editing the
    // Program afterward can never retroactively change this Workout.
    const workout = await this.prisma.workout.create({
      data: {
        userId,
        programId: program.id,
        name: program.name,
        scheduledAt: new Date(dto.scheduledAt),
        workoutExercises: {
          create: program.programExercises.map((pe) => ({
            order: pe.order,
            setsCount: pe.setsCount,
            targetReps: pe.targetReps,
            targetWeight: pe.targetWeight,
            exerciseId: pe.exerciseId,
            sets: {
              create: Array.from({ length: pe.setsCount }, (_, i) => ({
                setNumber: i + 1,
                targetReps: pe.targetReps,
                targetWeight: pe.targetWeight,
              })),
            },
          })),
        },
      },
      include: workoutDetailInclude,
    });

    return this.toDetailDto(workout);
  }

  async findAll(
    userId: string,
    query: ListWorkoutsQueryDto,
  ): Promise<CursorPaginatedResult<WorkoutSummaryResponseDto>> {
    const { cursor, limit, status } = query;

    // Still ascending by scheduledAt — soonest-upcoming first, matching
    // the brief's "list active or pending workouts sorted by date and
    // time." id is the compound-cursor tiebreaker for workouts scheduled
    // at the exact same instant.
    const keysetWhere = cursor
      ? buildKeysetWhere(
          'scheduledAt',
          'asc',
          decodeCursor(cursor),
          (v) => new Date(v),
        )
      : {};

    const rows = await this.prisma.workout.findMany({
      where: { userId, ...(status && { status }), ...keysetWhere },
      take: limit + 1,
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      include: { _count: { select: { workoutExercises: true } } },
    });

    const { page, hasMore, nextCursor } = paginateKeysetResults(
      rows,
      limit,
      (row) => row.scheduledAt,
      (row) => row.id,
    );

    return {
      data: page.map((w) => ({
        id: w.id,
        name: w.name,
        scheduledAt: w.scheduledAt,
        status: w.status,
        completedAt: w.completedAt,
        exerciseCount: w._count.workoutExercises,
        createdAt: w.createdAt,
      })),
      meta: { limit, hasMore, nextCursor },
    };
  }

  async findOne(userId: string, id: string): Promise<WorkoutDetailResponseDto> {
    const workout = await this.prisma.workout.findFirst({
      where: { id, userId },
      include: workoutDetailInclude,
    });

    if (!workout) {
      throw new NotFoundException(`Workout with id "${id}" not found`);
    }

    return this.toDetailDto(workout);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateWorkoutDto,
  ): Promise<WorkoutDetailResponseDto> {
    const existing = await this.getOwnedWorkoutOrThrow(userId, id);
    this.assertNotLocked(existing);

    const workout = await this.prisma.workout.update({
      where: { id },
      data: {
        ...(dto.scheduledAt !== undefined && {
          scheduledAt: new Date(dto.scheduledAt),
        }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
      include: workoutDetailInclude,
    });

    return this.toDetailDto(workout);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.getOwnedWorkoutOrThrow(userId, id);
    // No onDelete: Restrict anywhere pointing AT Workout (WorkoutExercise,
    // Set, Comment all cascade from it) — unlike Program's delete, this
    // needs no FK-violation handling.
    await this.prisma.workout.delete({ where: { id } });
  }

  // --- Structural editing (add/remove exercises, resize sets) ------------

  async addExercise(
    userId: string,
    workoutId: string,
    dto: AddWorkoutExerciseDto,
  ): Promise<WorkoutDetailResponseDto> {
    const existing = await this.getOwnedWorkoutOrThrow(userId, workoutId);
    this.assertNotLocked(existing);

    const exercise = await this.prisma.exercise.findUnique({
      where: { id: dto.exerciseId },
      select: { id: true },
    });
    if (!exercise) {
      throw new BadRequestException(
        `Exercise with id "${dto.exerciseId}" does not exist in the catalog`,
      );
    }

    await this.prisma.workoutExercise.create({
      data: {
        workoutId,
        order: dto.order,
        setsCount: dto.setsCount,
        targetReps: dto.targetReps,
        targetWeight: dto.targetWeight,
        exerciseId: dto.exerciseId,
        sets: {
          create: Array.from({ length: dto.setsCount }, (_, i) => ({
            setNumber: i + 1,
            targetReps: dto.targetReps,
            targetWeight: dto.targetWeight,
          })),
        },
      },
    });

    return this.findOne(userId, workoutId);
  }

  async removeExercise(
    userId: string,
    workoutId: string,
    workoutExerciseId: string,
  ): Promise<void> {
    const existing = await this.getOwnedWorkoutOrThrow(userId, workoutId);
    this.assertNotLocked(existing);

    await this.assertWorkoutExerciseBelongsToWorkout(
      workoutExerciseId,
      workoutId,
    );

    // Sets cascade automatically (WorkoutExercise -> Set is
    // onDelete: Cascade) — no manual cleanup needed. Unlike shrinking
    // setsCount below, we do NOT block this if sets have actuals; removing
    // an entire exercise is a deliberate, coarser action than trimming
    // sets, and re-adding a wrong exercise is a normal correction flow.
    await this.prisma.workoutExercise.delete({
      where: { id: workoutExerciseId },
    });
  }

  async updateExerciseSetsCount(
    userId: string,
    workoutId: string,
    workoutExerciseId: string,
    dto: UpdateWorkoutExerciseDto,
  ): Promise<WorkoutDetailResponseDto> {
    const existing = await this.getOwnedWorkoutOrThrow(userId, workoutId);
    this.assertNotLocked(existing);

    const workoutExercise = await this.assertWorkoutExerciseBelongsToWorkout(
      workoutExerciseId,
      workoutId,
    );

    const currentSets = await this.prisma.set.findMany({
      where: { workoutExerciseId },
      orderBy: { setNumber: 'asc' },
    });

    const delta = dto.setsCount - currentSets.length;

    if (delta > 0) {
      // Growing: append new Set rows continuing the setNumber sequence,
      // targets copied from the WorkoutExercise's own frozen targets.
      await this.prisma.set.createMany({
        data: Array.from({ length: delta }, (_, i) => ({
          workoutExerciseId,
          setNumber: currentSets.length + i + 1,
          targetReps: workoutExercise.targetReps,
          targetWeight: workoutExercise.targetWeight,
        })),
      });
    } else if (delta < 0) {
      // Shrinking: remove the highest-numbered sets first. Per our Stage 6
      // decision, we refuse to silently discard a set that already has a
      // recorded actual — that would be real logged data loss, distinct
      // from removing a whole exercise (which is a coarser, deliberate
      // action handled by removeExercise above).
      const setsToRemove = currentSets.slice(delta); // last |delta| entries
      const hasRecordedActuals = setsToRemove.some(
        (s) => s.actualReps !== null || s.actualWeight !== null,
      );

      if (hasRecordedActuals) {
        throw new ConflictException(
          'Cannot reduce setsCount: one or more of the sets being removed already has a recorded actual value. Delete the exercise entirely if you need to start over.',
        );
      }

      await this.prisma.set.deleteMany({
        where: { id: { in: setsToRemove.map((s) => s.id) } },
      });
    }

    await this.prisma.workoutExercise.update({
      where: { id: workoutExerciseId },
      data: { setsCount: dto.setsCount },
    });

    return this.findOne(userId, workoutId);
  }

  // --- Comments ------------------------------------------------------------

  async addComment(
    userId: string,
    workoutId: string,
    dto: CreateCommentDto,
  ): Promise<CommentDetailDto> {
    // Ownership only — comments are allowed even on a COMPLETED workout
    // (journaling/reflection after finishing a session is normal and
    // shouldn't be blocked by the structural lock).
    await this.getOwnedWorkoutOrThrow(userId, workoutId);

    const comment = await this.prisma.comment.create({
      data: { workoutId, userId, content: dto.content },
    });

    return {
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt,
      userId: comment.userId,
    };
  }

  // --- Completion derivation (called from Stage 7's SetsService) ---------

  // Public: SetsService will call this every time a Set's actuals are
  // written, per the cross-stage contract established when we planned
  // this stage. Idempotent — safe to call repeatedly.
  async recomputeCompletionStatus(workoutId: string): Promise<void> {
    const workout = await this.prisma.workout.findUnique({
      where: { id: workoutId },
      select: { status: true },
    });

    // Already terminal, or the workout was deleted mid-flight — nothing
    // to do. COMPLETED never gets recomputed away, by design.
    if (!workout || workout.status === WorkoutStatus.COMPLETED) {
      return;
    }

    const sets = await this.prisma.set.findMany({
      where: { workoutExercise: { workoutId } },
      select: { actualReps: true},
    });
    // Guard against the vacuous-truth edge case: a workout with zero sets
    // (e.g. every exercise was structurally removed) should never be
    // auto-marked complete.
    //
    // Completion signal is actualReps ONLY (not actualWeight) — per our
    // Stage 7 decision, reps is the universal signal across exercise
    // types in our current model (every strength set has reps; not every
    // set has meaningful weight, e.g. bodyweight exercises). actualWeight
    // remains independently optional and doesn't gate completion.
    const allSetsHaveActuals =
      sets.length > 0 && sets.every((s) => s.actualReps !== null);
    if (allSetsHaveActuals) {
      await this.prisma.workout.update({
        where: { id: workoutId },
        data: { status: WorkoutStatus.COMPLETED, completedAt: new Date() },
      });
    }
  }

  // --- internal helpers ----------------------------------------------------

  private async getOwnedWorkoutOrThrow(
    userId: string,
    id: string,
  ): Promise<Workout> {
    const workout = await this.prisma.workout.findFirst({
      where: { id, userId },
    });

    if (!workout) {
      throw new NotFoundException(`Workout with id "${id}" not found`);
    }

    return workout;
  }

  private assertNotLocked(workout: Workout): void {
    if (workout.status === WorkoutStatus.COMPLETED) {
      throw new ConflictException(LOCKED_MESSAGE);
    }
  }

  private async assertWorkoutExerciseBelongsToWorkout(
    workoutExerciseId: string,
    workoutId: string,
  ) {
    const workoutExercise = await this.prisma.workoutExercise.findFirst({
      where: { id: workoutExerciseId, workoutId },
    });

    if (!workoutExercise) {
      throw new NotFoundException(
        `Workout exercise with id "${workoutExerciseId}" not found on this workout`,
      );
    }

    return workoutExercise;
  }

  private toDetailDto(workout: WorkoutWithDetail): WorkoutDetailResponseDto {
    return {
      id: workout.id,
      name: workout.name,
      scheduledAt: workout.scheduledAt,
      status: workout.status,
      completedAt: workout.completedAt,
      programId: workout.programId,
      createdAt: workout.createdAt,
      updatedAt: workout.updatedAt,
      exercises: workout.workoutExercises.map(
        (we): WorkoutExerciseDetailDto => ({
          id: we.id,
          order: we.order,
          setsCount: we.setsCount,
          targetReps: we.targetReps,
          targetWeight: Number(we.targetWeight),
          exercise: {
            id: we.exercise.id,
            name: we.exercise.name,
            category: we.exercise.category,
            muscleGroup: we.exercise.muscleGroup,
          },
          sets: we.sets.map((s) => ({
            id: s.id,
            setNumber: s.setNumber,
            targetReps: s.targetReps,
            targetWeight: Number(s.targetWeight),
            actualReps: s.actualReps,
            actualWeight:
              s.actualWeight !== null ? Number(s.actualWeight) : null,
            completedAt: s.completedAt,
          })),
        }),
      ),
      comments: workout.comments.map((c) => ({
        id: c.id,
        content: c.content,
        createdAt: c.createdAt,
        userId: c.userId,
      })),
    };
  }
}
