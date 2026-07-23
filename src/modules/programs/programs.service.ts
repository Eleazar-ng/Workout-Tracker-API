import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Program } from 'generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProgramDto } from './dto/create-program.dto';
import { UpdateProgramDto } from './dto/update-program.dto';
import { ListProgramsQueryDto } from './dto/list-programs-query.dto';
import { ProgramExerciseInputDto } from './dto/program-exercise-input.dto';
import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import {
  ProgramDetailResponseDto,
  ProgramExerciseDetailDto,
} from './dto/program-detail-response.dto';
import { ProgramSummaryResponseDto } from './dto/program-summary-response.dto';

// Prisma's include shape for a Program with its exercises + each
// exercise's catalog details — defined once and reused so findOne/create/
// update all fetch and shape data identically.
const programDetailInclude = {
  programExercises: {
    include: { exercise: true },
    orderBy: { order: 'asc' },
  },
} satisfies Prisma.ProgramInclude;

type ProgramWithExercises = Prisma.ProgramGetPayload<{
  include: typeof programDetailInclude;
}>;

@Injectable()
export class ProgramsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    dto: CreateProgramDto,
  ): Promise<ProgramDetailResponseDto> {
    await this.assertExercisesExist(dto.exercises);

    // Prisma's nested `create` is atomic by default (runs as a single
    // transaction under the hood) — no explicit $transaction needed here,
    // unlike update() below where we're mixing a conditional delete+create
    // with a separate field update.
    const program = await this.prisma.program.create({
      data: {
        userId,
        name: dto.name,
        description: dto.description,
        programExercises: {
          create: dto.exercises.map((exercise) => ({
            order: exercise.order,
            setsCount: exercise.setsCount,
            targetReps: exercise.targetReps,
            targetWeight: exercise.targetWeight,
            exerciseId: exercise.exerciseId,
          })),
        },
      },
      include: programDetailInclude,
    });

    return this.toDetailDto(program);
  }

  async findAll(
    userId: string,
    query: ListProgramsQueryDto,
  ): Promise<PaginatedResult<ProgramSummaryResponseDto>> {
    const { page, limit } = query;

    const [programs, total] = await Promise.all([
      this.prisma.program.findMany({
        where: { userId },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        // _count avoids fetching every ProgramExercise row just to report
        // how many there are — one lightweight aggregate per row instead.
        include: { _count: { select: { programExercises: true } } },
      }),
      this.prisma.program.count({ where: { userId } }),
    ]);

    return {
      data: programs.map((program) => ({
        id: program.id,
        name: program.name,
        description: program.description,
        exerciseCount: program._count.programExercises,
        createdAt: program.createdAt,
        updatedAt: program.updatedAt,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(userId: string, id: string): Promise<ProgramDetailResponseDto> {
    const program = await this.prisma.program.findFirst({
      where: { id, userId },
      include: programDetailInclude,
    });

    if (!program) {
      throw new NotFoundException(`Program with id "${id}" not found`);
    }

    return this.toDetailDto(program);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateProgramDto,
  ): Promise<ProgramDetailResponseDto> {
    // Ownership check happens FIRST and separately, before touching
    // exercises — this guarantees a 404 (not a partially-applied update)
    // if the program doesn't belong to this user, and lets us reuse the
    // same not-found check remove() needs.
    await this.assertOwnership(userId, id);

    if (dto.exercises) {
      await this.assertExercisesExist(dto.exercises);
    }

    // Wrapped in $transaction because this is potentially TWO writes
    // (update the Program's own fields, then delete+recreate its
    // exercises) that must succeed or fail together — a partial write
    // here (e.g. fields updated but the exercise replace fails) would
    // leave the Program in an inconsistent state.
    const program = await this.prisma.$transaction(async (tx) => {
      await tx.program.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.description !== undefined && {
            description: dto.description,
          }),
        },
      });

      if (dto.exercises) {
        // Full replace, per our Stage 5 decision — safe because nothing
        // durably references a ProgramExercise.id (Workouts freeze their
        // own copy at creation time; see Stage 1's schema notes).
        await tx.programExercise.deleteMany({ where: { programId: id } });
        await tx.programExercise.createMany({
          data: dto.exercises.map((exercise) => ({
            programId: id,
            order: exercise.order,
            setsCount: exercise.setsCount,
            targetReps: exercise.targetReps,
            targetWeight: exercise.targetWeight,
            exerciseId: exercise.exerciseId,
          })),
        });
      }

      return tx.program.findUniqueOrThrow({
        where: { id },
        include: programDetailInclude,
      });
    });

    return this.toDetailDto(program);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.assertOwnership(userId, id);

    try {
      await this.prisma.program.delete({ where: { id } });
    } catch (error) {
      // P2003 = foreign key constraint violation. Given
      // Workout.programId uses onDelete: Restrict (see schema.prisma),
      // this fires when the user tries to delete a Program that still
      // has Workouts derived from it. We turn the raw DB error into a
      // clean, actionable 409 rather than letting a Postgres constraint
      // message leak to the client.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(
          'Cannot delete this program because it has workouts associated with it. ' +
            'Delete or reassign those workouts first.',
        );
      }
      throw error;
    }
  }

  // --- internal helpers -----------------------------------------------

  private async assertOwnership(userId: string, id: string): Promise<void> {
    const program: Pick<Program, 'id'> | null =
      await this.prisma.program.findFirst({
        where: { id, userId },
        select: { id: true },
      });

    // 404, not 403: returning 403 would confirm to a would-be attacker
    // that a Program with this ID exists but belongs to someone else.
    // 404 makes "doesn't exist" and "exists but isn't yours"
    // indistinguishable from the outside.
    if (!program) {
      throw new NotFoundException(`Program with id "${id}" not found`);
    }
  }

  private async assertExercisesExist(
    exercises: ProgramExerciseInputDto[],
  ): Promise<void> {
    const uniqueIds = [...new Set(exercises.map((e) => e.exerciseId))];

    const found = await this.prisma.exercise.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true },
    });

    if (found.length !== uniqueIds.length) {
      const foundIds = new Set(found.map((e) => e.id));
      const missing = uniqueIds.filter((id) => !foundIds.has(id));
      throw new BadRequestException(
        `The following exerciseId(s) do not exist in the catalog: ${missing.join(', ')}`,
      );
    }
  }

  private toDetailDto(program: ProgramWithExercises): ProgramDetailResponseDto {
    return {
      id: program.id,
      name: program.name,
      description: program.description,
      createdAt: program.createdAt,
      updatedAt: program.updatedAt,
      exercises: program.programExercises.map(
        (pe): ProgramExerciseDetailDto => ({
          id: pe.id,
          order: pe.order,
          setsCount: pe.setsCount,
          targetReps: pe.targetReps,
          targetWeight: Number(pe.targetWeight),
          exercise: {
            id: pe.exercise.id,
            name: pe.exercise.name,
            category: pe.exercise.category,
            muscleGroup: pe.exercise.muscleGroup,
          },
        }),
      ),
    };
  }
}
