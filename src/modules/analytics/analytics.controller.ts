import { Controller, Get, Param, Query } from '@nestjs/common';
import type { User } from 'generated/prisma/client';
import { AnalyticsService } from './analytics.service';
import { DateRangeQueryDto } from './dto/date-range-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('exercises/:exerciseId/progress')
  getExerciseProgress(
    @CurrentUser() user: User,
    @Param('exerciseId') exerciseId: string,
  ) {
    return this.analyticsService.getExerciseProgress(user.id, exerciseId);
  }

  @Get('programs/:programId/adherence')
  getProgramAdherence(
    @CurrentUser() user: User,
    @Param('programId') programId: string,
  ) {
    return this.analyticsService.getProgramAdherence(user.id, programId);
  }

  @Get('streak')
  getStreak(@CurrentUser() user: User) {
    return this.analyticsService.getStreak(user.id);
  }

  @Get('summary')
  getSummary(@CurrentUser() user: User, @Query() query: DateRangeQueryDto) {
    return this.analyticsService.getSummary(user.id, query);
  }
}
