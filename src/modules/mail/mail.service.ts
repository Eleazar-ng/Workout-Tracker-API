import { Injectable, Logger } from '@nestjs/common';

// STUBBED TRANSPORT, deliberately. Per our Stage 4 decision: the hard part
// (secure token generation/expiry/single-use enforcement, in
// EmailVerificationService/PasswordResetService) is fully real. This
// service only handles the last-mile "actually send the email" step,
// which is stubbed to log the link to the console instead of dispatching
// real email — real transport (Resend, SMTP, SES, etc.) is deferred until
// the deployment target is chosen (Stage 14), since the provider choice
// often depends on where the app is hosted.
//
// Because this is a separate, narrow, injectable service, swapping the
// stub for a real implementation later means changing ONLY this file —
// nothing in AuthService/EmailVerificationService/PasswordResetService
// needs to change, since they depend on this interface, not on how email
// actually gets sent.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  sendVerificationEmail(to: string, link: string): Promise<void> {
    this.logger.log(
      `[STUB EMAIL] Verification link for ${to}:\n  ${link}\n` +
        '(Real email delivery not yet configured — see MailService.)',
    );
    return Promise.resolve();
  }

  sendPasswordResetEmail(to: string, link: string): Promise<void> {
    this.logger.log(
      `[STUB EMAIL] Password reset link for ${to}:\n  ${link}\n` +
        '(Real email delivery not yet configured — see MailService.)',
    );
    return Promise.resolve();
  }
}
