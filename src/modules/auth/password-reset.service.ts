import { BadRequestException, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { AuthService } from './auth.service';
import { generateOpaqueToken, hashToken } from '../../common/utils/token.util';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';

// Deliberately SHORT compared to email verification (24h) — a
// password-reset link is a more sensitive artifact (anyone holding it can
// take over the account), so we minimize the window it's usable in.
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

@Injectable()
export class PasswordResetService {
  private readonly appBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {
    this.appBaseUrl = this.configService.get<AppConfig>('app')!.baseUrl;
  }

  // Always resolves successfully regardless of whether the email exists —
  // per our Stage 4 decision, this prevents an attacker from using this
  // endpoint to enumerate registered emails. If the user doesn't exist (or
  // is an OAuth-only user with no password to reset), we simply do
  // nothing further, but the caller (controller) returns the same
  // generic "if an account exists, an email has been sent" response
  // either way.
  async requestReset(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);

    if (!user || !user.passwordHash) {
      return;
    }

    const rawToken = generateOpaqueToken();

    await this.prisma.passwordResetToken.create({
      data: {
        tokenHash: hashToken(rawToken),
        userId: user.id,
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    const link = `${this.appBaseUrl}/auth/reset-password?token=${rawToken}`;
    await this.mailService.sendPasswordResetEmail(user.email, link);
  }

  async confirmReset(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = hashToken(rawToken);

    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const newPasswordHash = await argon2.hash(newPassword);

    // Mark the token used and update the password together — same
    // all-or-nothing reasoning as EmailVerificationService.confirmVerification.
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: newPasswordHash },
      }),
    ]);

    // A password reset is a strong signal the user wants every existing
    // session terminated — especially relevant if the reset was triggered
    // because credentials were compromised. Runs AFTER the transaction
    // commits, so we only revoke sessions once we're certain the new
    // password was actually persisted.
    await this.authService.revokeAllRefreshTokens(record.userId);
  }
}
