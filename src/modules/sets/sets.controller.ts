import { Body, Controller, Param, Patch } from '@nestjs/common';
import type { User } from 'generated/prisma/client';
import { SetsService } from './sets.service';
import { UpdateSetDto } from './dto/update-set.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

// Flat, not nested under /workouts — per our Stage 7 decision. This is
// the highest-frequency write endpoint in the app (every set of every
// workout goes through here), and the client always already has the
// specific Set id in hand from a prior GET /workouts/:id response, so
// there's no ergonomic benefit to threading the parent workout/exercise
// ids through the URL. Ownership is still fully enforced server-side via
// a join (see SetsService.updateActuals) regardless of URL shape.
@Controller('sets')
export class SetsController {
  constructor(private readonly setsService: SetsService) {}

  @Patch(':id')
  updateActuals(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateSetDto,
  ) {
    return this.setsService.updateActuals(user.id, id, dto);
  }
}
