import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type { User } from 'generated/prisma/client';
import { SocialService } from './social.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { FeedQueryDto } from './dto/feed-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('social')
export class SocialController {
  constructor(private readonly socialService: SocialService) {}

  @Post('follow/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  follow(@CurrentUser() user: User, @Param('userId') userId: string) {
    return this.socialService.follow(user.id, userId);
  }

  @Delete('follow/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  unfollow(@CurrentUser() user: User, @Param('userId') userId: string) {
    return this.socialService.unfollow(user.id, userId);
  }

  @Get('followers')
  getFollowers(@CurrentUser() user: User, @Query() query: PaginationQueryDto) {
    return this.socialService.getFollowers(user.id, query);
  }

  @Get('following')
  getFollowing(@CurrentUser() user: User, @Query() query: PaginationQueryDto) {
    return this.socialService.getFollowing(user.id, query);
  }

  @Get('feed')
  getFeed(@CurrentUser() user: User, @Query() query: FeedQueryDto) {
    return this.socialService.getFeed(user.id, query);
  }
}
