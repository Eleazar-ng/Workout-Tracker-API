import { IsEnum, IsOptional } from 'class-validator';
import { WorkoutStatus } from 'generated/prisma/enums';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListWorkoutsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(WorkoutStatus)
  status?: WorkoutStatus;
}
