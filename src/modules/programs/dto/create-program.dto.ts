import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ProgramExerciseInputDto } from './program-exercise-input.dto';

export class CreateProgramDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  // A Program with zero exercises isn't a usable template — enforcing at
  // least one here catches an obviously-incomplete payload at the
  // validation layer rather than letting an empty Program get created and
  // failing confusingly later when a Workout tries to derive from it.
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProgramExerciseInputDto)
  exercises!: ProgramExerciseInputDto[];
}
