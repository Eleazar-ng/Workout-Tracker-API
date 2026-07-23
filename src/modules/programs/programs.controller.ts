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
import { ProgramsService } from './programs.service';
import { CreateProgramDto } from './dto/create-program.dto';
import { UpdateProgramDto } from './dto/update-program.dto';
import { ListProgramsQueryDto } from './dto/list-programs-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

// No @Public()/@AllowUnverified() anywhere in this controller — every
// route here sits behind the default global JwtAuthGuard (authenticated
// AND email-verified required), which is exactly right: creating and
// managing workout programs is core, private, per-user functionality.
@Controller('programs')
export class ProgramsController {
  constructor(private readonly programsService: ProgramsService) {}

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateProgramDto) {
    return this.programsService.create(user.id, dto);
  }

  @Get()
  findAll(@CurrentUser() user: User, @Query() query: ListProgramsQueryDto) {
    return this.programsService.findAll(user.id, query);
  }

  @Get(':id')
  findOne(@CurrentUser() user: User, @Param('id') id: string) {
    return this.programsService.findOne(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateProgramDto,
  ) {
    return this.programsService.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: User, @Param('id') id: string): Promise<void> {
    return this.programsService.remove(user.id, id);
  }
}
