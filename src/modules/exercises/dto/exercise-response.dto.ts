import { ExerciseCategory, MuscleGroup } from "generated/prisma/enums";

// A plain response-shaping class (not validated — nothing to validate on
// the way OUT). Kept separate from the Prisma model type so the API
// contract is explicit and doesn't accidentally leak internal fields if
// the Exercise model grows columns later that shouldn't be public.
export class ExerciseResponseDto {
  id!: string;
  name!: string;
  description!: string;
  category!: ExerciseCategory;
  muscleGroup!: MuscleGroup;
  createdAt!: Date;
  updatedAt!: Date;
}
