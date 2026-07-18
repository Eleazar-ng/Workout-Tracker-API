import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ListExercisesQueryDto } from './dto/list-exercises-query.dto';
import { PaginatedResult } from 'src/common/interfaces/paginated-result.interface';
import { Exercise } from 'generated/prisma/client';

@Injectable()
export class ExercisesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: ListExercisesQueryDto,
  ): Promise<PaginatedResult<Exercise>> {
    const { page, limit, category, muscleGroup } = query;

    // Build the where-clause only from filters that were actually
    // provided — an undefined value here would otherwise make Prisma
    // filter on "field equals undefined", which is not what we want.
    const where = {
      ...(category && { category }),
      ...(muscleGroup && { muscleGroup }),
    };

    // Run the count and the page fetch concurrently rather than
    // sequentially — they're independent queries, so awaiting them one at
    // a time would just add unnecessary latency to every list request.
    const [data, total] = await Promise.all([
      this.prisma.exercise.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.exercise.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
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
