import { Controller, Get, Param, Query } from '@nestjs/common';
import { ExercisesService } from './exercises.service';
import { ListExercisesQueryDto } from './dto/list-exercises-query.dto';

// NOTE: This module is intentionally READ-ONLY for now. Create/update/
// delete endpoints for the exercise catalog are deferred until Stage 4
// (Auth) gives us a role-based guard to gate them behind an admin role —
// per our decision, we don't want to ship an unprotected write endpoint
// even temporarily. Until then, the catalog is populated exclusively via
// the seed script (prisma/seed.ts).
@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Get()
  findAll(@Query() query: ListExercisesQueryDto) {
    return this.exercisesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.exercisesService.findOne(id);
  }
}
