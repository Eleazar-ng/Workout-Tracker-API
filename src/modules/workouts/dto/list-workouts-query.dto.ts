import { IsEnum, IsOptional } from 'class-validator';
import { WorkoutStatus } from 'generated/prisma/enums';
import { CursorPaginationQueryDto } from 'src/common/dto/cursor-pagination-query.dto';

export class ListWorkoutsQueryDto extends CursorPaginationQueryDto {
  @IsOptional()
  @IsEnum(WorkoutStatus)
  status?: WorkoutStatus;
}
