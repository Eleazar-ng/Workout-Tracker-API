import { Module } from '@nestjs/common';
import { UsersService } from './users.service';

// No controller yet — see the note atop users.service.ts. This module
// currently exists purely to be imported by AuthModule.
@Module({
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
