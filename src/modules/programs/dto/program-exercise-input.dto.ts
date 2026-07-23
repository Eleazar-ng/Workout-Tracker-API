import { IsInt, IsNumber, IsUUID, Min } from 'class-validator';

// One entry in the nested `exercises` array of Create/UpdateProgramDto.
// Matches the fixed-target-per-set decision from Stage 1: one target
// reps/weight applies to every set in setsCount, rather than each set
// having its own target (no pyramid/drop-set support at the Program
// level).
export class ProgramExerciseInputDto {
  @IsUUID()
  exerciseId!: string;

  // Position within the program — the client controls ordering
  // explicitly rather than us inferring it from array position, so
  // reordering is unambiguous even if entries are added/removed in the
  // same request.
  @IsInt()
  @Min(0)
  order!: number;

  @IsInt()
  @Min(1)
  setsCount!: number;

  @IsInt()
  @Min(1)
  targetReps!: number;

  // Weight as a plain number over the wire; Prisma stores it as
  // Decimal(6,2) at rest. maxDecimalPlaces guards against a client
  // sending more precision than the column supports.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  targetWeight!: number;
}
