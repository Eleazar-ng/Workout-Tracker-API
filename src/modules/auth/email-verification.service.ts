import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { generateOpaqueToken, hashToken } from '../../common/utils/token.util';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';

// Token lifetime for email verification — deliberately longer than a
// password reset token (see PasswordResetService), since a lost
// verification link is annoying but not a security-sensitive event the
// way a lingering, unused password-reset link is.
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

@Injectable()
export class EmailVerificationService {
  private readonly appBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {
    this.appBaseUrl = this.configService.get<AppConfig>('app')!.baseUrl;
  }

  // Called right after signup, and again from resendVerification(). Each
  // call issues a NEW token — we deliberately do not invalidate prior
  // unused tokens here (a user who clicks an older email link before a
  // newer one should still succeed), but each token is independently
  // single-use and expiring, so this doesn't weaken security.
  async issueVerificationToken(userId: string, email: string): Promise<void> {
    const rawToken = generateOpaqueToken();

    await this.prisma.emailVerificationToken.create({
      data: {
        tokenHash: hashToken(rawToken),
        userId,
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
      },
    });

    const link = `${this.appBaseUrl}/auth/verify-email?token=${rawToken}`;
    await this.mailService.sendVerificationEmail(email, link);
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      // Shouldn't happen in practice (caller already has an authenticated
      // user), but fail loudly rather than silently no-op if it does.
      throw new BadRequestException('User not found');
    }

    if (user.emailVerifiedAt) {
      throw new BadRequestException('Email is already verified');
    }

    await this.issueVerificationToken(user.id, user.email);
  }

  async confirmVerification(rawToken: string): Promise<void> {
    const tokenHash = hashToken(rawToken);

    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    });

    if (
      !record ||
      record.usedAt ||
      record.expiresAt < new Date()
    ) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    // Mark the token used and verify the user's email in one transaction
    // — if either write failed independently, we could end up with a
    // consumed token that never actually verified the user (or vice
    // versa). $transaction guarantees both happen together or neither does.
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      }),
    ]);
  }
}
