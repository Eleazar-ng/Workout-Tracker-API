import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ListExercisesQueryDto } from './dto/list-exercises-query.dto';
import { CursorPaginatedResult } from '../../common/interfaces/cursor-paginated-result.interface';
import { Exercise } from 'generated/prisma/client';
import {
  buildKeysetWhere,
  decodeCursor,
  paginateKeysetResults,
} from '../../common/utils/cursor-pagination.util';
@Injectable()
export class ExercisesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: ListExercisesQueryDto,
  ): Promise<CursorPaginatedResult<Exercise>> {
    const { cursor, limit, category, muscleGroup } = query;

    // Sorted by `name` — already a @unique field on Exercise (see
    // schema.prisma), so it's a valid keyset cursor field on its own.
    // We still pass it through the same (value, id) compound-cursor
    // utility as every other endpoint for consistency, even though the
    // `id` tiebreaker is technically redundant here — one pattern to
    // reason about across the whole codebase beats a special case for
    // the one model that happens to have a unique sort field.
    const keysetWhere = cursor
      ? buildKeysetWhere('name', 'asc', decodeCursor(cursor), (v) => v)
      : {};

    // Build the where-clause only from filters that were actually
    // provided — an undefined value here would otherwise make Prisma
    // filter on "field equals undefined", which is not what we want.
    const where = {
      ...(category && { category }),
      ...(muscleGroup && { muscleGroup }),
      ...keysetWhere,
    };

    const rows = await this.prisma.exercise.findMany({
      where,
      take: limit + 1,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    const { page, hasMore, nextCursor } = paginateKeysetResults(
      rows,
      limit,
      (row) => row.name,
      (row) => row.id,
    );

    return { data: page, meta: { limit, hasMore, nextCursor } };
  }

  async findOne(id: string): Promise<Exercise> {
    const exercise = await this.prisma.exercise.findUnique({
      where: { id },
    });

    if (!exercise) {
      throw new NotFoundException(`Exercise with id "${id}" not found`);
    }

    return exercise;
  }
}
