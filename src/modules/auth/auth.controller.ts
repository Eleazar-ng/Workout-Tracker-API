import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Public } from '../../common/decorators/public.decorator';
import { AllowUnverified } from '../../common/decorators/allow-unverified.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  getRefreshTokenCookieOptions,
  REFRESH_TOKEN_COOKIE_NAME,
} from '../../common/constants/cookie.constants';
import { UsersService } from '../users/users.service';
import { EmailVerificationService } from './email-verification.service';
import { PasswordResetService } from './password-reset.service';
import type { AuthenticatedRequest } from '../../common/interfaces/authenticated-request.interface';
import type { User } from 'generated/prisma/client';

@Controller('auth')
export class AuthController {
  private readonly isProduction: boolean;

  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly passwordResetService: PasswordResetService,
  ) {
    this.isProduction =
      this.configService.get<string>('app.nodeEnv') === 'production';
  }

    // Stricter than the global default — brute-force/enumeration protection
  // for the sensitive Auth endpoints, deferred from Stage 4 and closed
  // out here. 5 requests per minute per IP (ThrottlerGuard's default
  // tracking key) is generous enough for a real user retrying a typo, but
  // tight enough to meaningfully slow down automated abuse.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Public()
  @Post('signup')
  async signup(
    @Body() dto: SignupDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.signup(dto);
    this.setRefreshTokenCookie(res, result.rawRefreshToken, result.refreshTokenExpiresAt);

    // Fire-and-forget from the caller's perspective, but awaited here so
    // any failure surfaces as a 500 rather than being silently swallowed
    // — better to know immediately in dev/testing if the stub (or later,
    // real) mail step breaks, rather than discover it only when a user
    // reports never receiving a verification email.
    await this.emailVerificationService.issueVerificationToken(
      result.user.id,
      result.user.email,
    );

    return { accessToken: result.accessToken, user: result.user };
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.login(dto);
    this.setRefreshTokenCookie(res, result.rawRefreshToken, result.refreshTokenExpiresAt);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    const rawRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];
    if (!rawRefreshToken) {
      throw new UnauthorizedException('No refresh token provided');
    }

    const result = await this.authService.refresh(rawRefreshToken);
    this.setRefreshTokenCookie(res, result.rawRefreshToken, result.refreshTokenExpiresAt);
    return { accessToken: result.accessToken };
  }

  // Public, not just AllowUnverified: logout should work even if the
  // user's access token has already expired (it's short-lived, 15m by
  // default) as long as they still hold a valid refresh cookie. Requiring
  // a fresh access token here would create an annoying edge case where a
  // user can't log out without effectively logging in again first.
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const rawRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];
    if (rawRefreshToken) {
      await this.authService.logout(rawRefreshToken);
    }
    res.clearCookie(
      REFRESH_TOKEN_COOKIE_NAME,
      getRefreshTokenCookieOptions(this.isProduction),
    );
  }

  // --- Google OAuth -------------------------------------------------------

  // This handler's body never runs — AuthGuard('google') intercepts the
  // request and redirects to Google's consent screen. The route exists
  // purely to give Passport a URL to hang the guard off of.
  @Public()
  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleAuth(): void {
    // Intentionally empty.
  }

  @Public()
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthCallback(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    // GoogleStrategy.validate() already resolved this to a User (creating
    // or linking one as needed) and Passport attached it to req.user.
    // Typing `req` as AuthenticatedRequest (rather than plain Request)
    // means `req.user` is directly and correctly typed as our Prisma
    // User — no cast needed, and no reliance on global declaration
    // merging (see authenticated-request.interface.ts for why we moved
    // away from that approach).
    const user = req.user ;
    const tokens = await this.authService.issueTokensForOAuthLogin(user);
    this.setRefreshTokenCookie(res, tokens.rawRefreshToken, tokens.refreshTokenExpiresAt);
    return { accessToken: tokens.accessToken, user: this.usersService.toResponseDto(user) };
  }

  // --- Email verification --------------------------------------------------

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('verify-email')
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ message: string }> {
    await this.emailVerificationService.confirmVerification(dto.token);
    return { message: 'Email verified successfully' };
  }

  // Requires authentication (so we know WHOSE verification to resend) but
  // explicitly allows an unverified user to call it — otherwise an
  // unverified user could never reach this endpoint in the first place,
  // since the default guard behavior blocks unverified users everywhere.
  @AllowUnverified()
  @HttpCode(HttpStatus.OK)
  @Post('resend-verification')
  async resendVerification(
    @CurrentUser() user: User,
  ): Promise<{ message: string }> {
    await this.emailVerificationService.resendVerification(user.id);
    return { message: 'Verification email sent' };
  }

  // --- Password reset -------------------------------------------------------

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    await this.passwordResetService.requestReset(dto.email);
    // Same generic response regardless of whether the email exists — see
    // PasswordResetService.requestReset for the enumeration-prevention
    // reasoning.
    return {
      message:
        'If an account with that email exists, a password reset link has been sent',
    };
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    await this.passwordResetService.confirmReset(dto.token, dto.newPassword);
    return { message: 'Password reset successfully' };
  }

  private setRefreshTokenCookie(
    res: Response,
    rawRefreshToken: string,
    expiresAt: Date,
  ): void {
    const maxAgeMs = expiresAt.getTime() - Date.now();
    res.cookie(
      REFRESH_TOKEN_COOKIE_NAME,
      rawRefreshToken,
      getRefreshTokenCookieOptions(this.isProduction, maxAgeMs),
    );
  }
}
