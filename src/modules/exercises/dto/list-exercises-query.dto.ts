import { IsEnum, IsOptional } from 'class-validator';
import { ExerciseCategory, MuscleGroup } from 'generated/prisma/enums';
import { CursorPaginationQueryDto } from 'src/common/dto/cursor-pagination-query.dto';

// Extends the shared pagination base so `page`/`limit` behave identically
// to every other list endpoint, and adds the two filters that make sense
// for browsing a fixed catalog: narrowing by category (STRENGTH/CARDIO/
// FLEXIBILITY/BALANCE) or by muscle group.
export class ListExercisesQueryDto extends CursorPaginationQueryDto {
  @IsOptional()
  @IsEnum(ExerciseCategory)
  category?: ExerciseCategory;

  @IsOptional()
  @IsEnum(MuscleGroup)
  muscleGroup?: MuscleGroup;
}
