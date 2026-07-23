import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

// Global for the same reason as ConfigModule/PrismaModule — mail sending
// is infrastructure, needed by multiple auth-related flows, not a bounded
// domain concern in its own right.
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
