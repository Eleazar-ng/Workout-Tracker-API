import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// Base pagination query params, meant to be extended by each module's own
// list-query DTO (e.g. ListExercisesQueryDto extends this and adds
// category/muscleGroup filters). Keeping this in common/ rather than
// duplicating page/limit fields in every module's DTO is what makes the
// pagination CONTRACT consistent across the whole API — every list
// endpoint we build from here on accepts the same page/limit params and
// returns the same envelope shape (see PaginatedResult below).
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number) // query params arrive as strings; class-transformer coerces them
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100) // hard ceiling — prevents a client requesting an unbounded page size
  limit: number = 20;
}
