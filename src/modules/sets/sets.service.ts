import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkoutsService } from '../workouts/workouts.service';
import { UpdateSetDto } from './dto/update-set.dto';
import { SetResponseDto } from './dto/set-response.dto';
import { WorkoutStatus } from 'generated/prisma/enums';

@Injectable()
export class SetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workoutsService: WorkoutsService,
  ) {}

  async updateActuals(
    userId: string,
    setId: string,
    dto: UpdateSetDto,
  ): Promise<SetResponseDto> {
    if (dto.actualReps === undefined && dto.actualWeight === undefined) {
      throw new ConflictException(
        'Provide at least one of actualReps or actualWeight to update',
      );
    }

    // Ownership is verified via a join across Set -> WorkoutExercise ->
    // Workout -> userId. There is no nested URL here (flat /sets/:id, per
    // our Stage 7 decision) so this join is the ONLY place ownership is
    // enforced — unlike Workouts' structural-edit endpoints, which have
    // the same join but reinforced by workoutId also appearing in the URL.
    const set = await this.prisma.set.findFirst({
      where: { id: setId, workoutExercise: { workout: { userId } } },
      include: { workoutExercise: { include: { workout: true } } },
    });

    if (!set) {
      throw new NotFoundException(`Set with id "${setId}" not found`);
    }

    const workout = set.workoutExercise.workout;
    const isLocked = workout.status === WorkoutStatus.COMPLETED;

    // Per our Stage 7 decision: once a Workout is COMPLETED, a Set's
    // actuals can still be CORRECTED (changed to a different non-null
    // value) but never UNSET (changed back to null). Un-setting would
    // silently break the invariant that defines COMPLETED in the first
    // place — "every set has actualReps recorded" — leaving the workout
    // marked complete while no longer actually satisfying that condition.
    if (isLocked) {
      const revertingReps =
        dto.actualReps === null && set.actualReps !== null;
      const revertingWeight =
        dto.actualWeight === null && set.actualWeight !== null;

      if (revertingReps || revertingWeight) {
        throw new ConflictException(
          'This workout is completed. Recorded values can be corrected but not cleared.',
        );
      }
    }

    // completedAt tracks when THIS SET was first marked done — set the
    // moment actualReps transitions from null to non-null, left untouched
    // on subsequent corrections, and cleared if reps are un-set (only
    // possible pre-completion, per the lock above).
    let completedAtUpdate: Date | null | undefined = undefined;
    if (dto.actualReps !== undefined) {
      if (dto.actualReps !== null && set.actualReps === null) {
        completedAtUpdate = new Date();
      } else if (dto.actualReps === null) {
        completedAtUpdate = null;
      }
    }

    const updated = await this.prisma.set.update({
      where: { id: setId },
      data: {
        ...(dto.actualReps !== undefined && { actualReps: dto.actualReps }),
        ...(dto.actualWeight !== undefined && {
          actualWeight: dto.actualWeight,
        }),
        ...(completedAtUpdate !== undefined && {
          completedAt: completedAtUpdate,
        }),
      },
    });

    // Idempotent and safe to call unconditionally — it no-ops immediately
    // if the workout is already COMPLETED (see
    // WorkoutsService.recomputeCompletionStatus), and re-derives status
    // otherwise. This is the cross-stage contract established in Stage 6.
    await this.workoutsService.recomputeCompletionStatus(workout.id);

    // Re-fetch the workout's status in case this update just completed
    // it — the `workout` object above is a snapshot from before this
    // update, so its `status` field could now be stale.
    const currentWorkout = await this.prisma.workout.findUniqueOrThrow({
      where: { id: workout.id },
      select: { status: true },
    });

    return {
      id: updated.id,
      setNumber: updated.setNumber,
      targetReps: updated.targetReps,
      targetWeight: Number(updated.targetWeight),
      actualReps: updated.actualReps,
      actualWeight:
        updated.actualWeight !== null ? Number(updated.actualWeight) : null,
      completedAt: updated.completedAt,
      workoutId: workout.id,
      workoutStatus: currentWorkout.status,
    };
  }
}
