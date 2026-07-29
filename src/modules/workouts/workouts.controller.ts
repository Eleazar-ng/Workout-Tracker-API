import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { User } from 'generated/prisma/client';
import { WorkoutsService } from './workouts.service';
import { CreateWorkoutDto } from './dto/create-workout.dto';
import { UpdateWorkoutDto } from './dto/update-workout.dto';
import { ListWorkoutsQueryDto } from './dto/list-workouts-query.dto';
import { AddWorkoutExerciseDto } from './dto/add-workout-exercise.dto';
import { UpdateWorkoutExerciseDto } from './dto/update-workout-exercise.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

// No @Public() anywhere in this controller — every route here sits behind
// the global JwtAuthGuard by default (see jwt-auth.guard.ts), and every
// method scopes its query by the authenticated user's id. There is no
// admin/cross-user access path in this module.
@Controller('workouts')
export class WorkoutsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateWorkoutDto) {
    return this.workoutsService.create(user.id, dto);
  }

  @Get()
  findAll(@CurrentUser() user: User, @Query() query: ListWorkoutsQueryDto) {
    return this.workoutsService.findAll(user.id, query);
  }

  @Get(':id')
  findOne(@CurrentUser() user: User, @Param('id') id: string) {
    return this.workoutsService.findOne(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateWorkoutDto,
  ) {
    return this.workoutsService.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    return this.workoutsService.remove(user.id, id);
  }

  // --- Structural editing ---------------------------------------------------

  @Post(':id/exercises')
  addExercise(
    @CurrentUser() user: User,
    @Param('id') workoutId: string,
    @Body() dto: AddWorkoutExerciseDto,
  ) {
    return this.workoutsService.addExercise(user.id, workoutId, dto);
  }

  @Patch(':id/exercises/:workoutExerciseId')
  updateExerciseSetsCount(
    @CurrentUser() user: User,
    @Param('id') workoutId: string,
    @Param('workoutExerciseId') workoutExerciseId: string,
    @Body() dto: UpdateWorkoutExerciseDto,
  ) {
    return this.workoutsService.updateExerciseSetsCount(
      user.id,
      workoutId,
      workoutExerciseId,
      dto,
    );
  }

  @Delete(':id/exercises/:workoutExerciseId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeExercise(
    @CurrentUser() user: User,
    @Param('id') workoutId: string,
    @Param('workoutExerciseId') workoutExerciseId: string,
  ) {
    return this.workoutsService.removeExercise(
      user.id,
      workoutId,
      workoutExerciseId,
    );
  }

  // --- Comments --------------------------------------------------------------

  @Post(':id/comments')
  addComment(
    @CurrentUser() user: User,
    @Param('id') workoutId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.workoutsService.addComment(user.id, workoutId, dto);
  }
}
