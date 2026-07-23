import { ExerciseCategory, MuscleGroup } from "generated/prisma/enums";

// Nested exercise shape returned within a Program's detail view — includes
// a slice of the catalog Exercise's own fields (name/category/muscleGroup)
// so a client doesn't need a second round-trip to render a readable
// program (e.g. showing "Bench Press" instead of just an opaque
// exerciseId).
export class ProgramExerciseDetailDto {
  id!: string;
  order!: number;
  setsCount!: number;
  targetReps!: number;
  targetWeight!: number;
  exercise!: {
    id: string;
    name: string;
    category: ExerciseCategory;
    muscleGroup: MuscleGroup;
  };
}

export class ProgramDetailResponseDto {
  id!: string;
  name!: string;
  description!: string | null;
  createdAt!: Date;
  updatedAt!: Date;
  exercises!: ProgramExerciseDetailDto[];
}
