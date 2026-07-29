import { ExerciseCategory, MuscleGroup, WorkoutStatus } from "generated/prisma/enums";

export class SetDetailDto {
  id!: string;
  setNumber!: number;
  targetReps!: number;
  targetWeight!: number;
  actualReps!: number | null;
  actualWeight!: number | null;
  completedAt!: Date | null;
}

export class WorkoutExerciseDetailDto {
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
  sets!: SetDetailDto[];
}

export class CommentDetailDto {
  id!: string;
  content!: string;
  createdAt!: Date;
  userId!: string;
}

export class WorkoutDetailResponseDto {
  id!: string;
  name!: string;
  scheduledAt!: Date;
  status!: WorkoutStatus;
  completedAt!: Date | null;
  programId!: string;
  createdAt!: Date;
  updatedAt!: Date;
  exercises!: WorkoutExerciseDetailDto[];
  comments!: CommentDetailDto[];
}
