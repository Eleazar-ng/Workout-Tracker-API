import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { generateOpaqueToken, hashToken } from '../../common/utils/token.util';
import { AuthConfig } from '../../config/configuration';
import { User } from 'generated/prisma/client';

// Bundled return type for token-issuance methods: callers (the controller)
// need the raw refresh token to set as a cookie, but the raw value must
// NEVER be persisted — only its hash is stored (see issueRefreshToken).
interface IssuedTokens {
  accessToken: string;
  rawRefreshToken: string;
  refreshTokenExpiresAt: Date;
}

@Injectable()
export class AuthService {
  private readonly authConfig: AuthConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.authConfig = this.configService.get<AuthConfig>('auth')!;
  }

  async signup(dto: SignupDto): Promise<AuthResponseDto & { rawRefreshToken: string; refreshTokenExpiresAt: Date }> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      // Deliberately specific here (unlike login) — signup already
      // requires knowing the email exists to be useful ("this address is
      // taken"), so there's no enumeration concern to hide behind a
      // generic message the way there is on login/forgot-password.
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await argon2.hash(dto.password);

    const user = await this.usersService.createLocalUser({
      email: dto.email,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
    });

    const tokens = await this.issueTokens(user);

    return {
      accessToken: tokens.accessToken,
      user: this.usersService.toResponseDto(user),
      rawRefreshToken: tokens.rawRefreshToken,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    };
  }

  async login(dto: LoginDto): Promise<AuthResponseDto & { rawRefreshToken: string; refreshTokenExpiresAt: Date }> {
    const user = await this.usersService.findByEmail(dto.email);

    // Generic error for BOTH "no such user" and "wrong password" — per
    // our decision, this prevents an attacker from using this endpoint to
    // enumerate which emails have accounts. We still run argon2.verify
    // against a dummy hash when the user doesn't exist, so the response
    // TIME doesn't leak that distinction either (a naive early-return
    // would make "user not found" respond faster than "wrong password",
    // which is itself a timing side-channel).
    if (!user || !user.passwordHash) {
      await argon2.hash('dummy-value-to-equalize-timing');
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.issueTokens(user);

    return {
      accessToken: tokens.accessToken,
      user: this.usersService.toResponseDto(user),
      rawRefreshToken: tokens.rawRefreshToken,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    };
  }

  // Exchanges a valid, unrevoked refresh token for a new access token AND
  // a new refresh token (rotation). The old refresh token is revoked in
  // the same operation. Rotation-on-use means a stolen-but-unused refresh
  // token becomes worthless the moment the legitimate user's client next
  // refreshes — and if an attacker DOES use a stolen token first, the
  // legitimate user's subsequent refresh attempt will fail (their token
  // was already revoked), which is a detectable signal of compromise.
  async refresh(rawRefreshToken: string): Promise<IssuedTokens & { user: User }> {
    const tokenHash = hashToken(rawRefreshToken);

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !storedToken ||
      storedToken.revokedAt ||
      storedToken.expiresAt < new Date()
    ) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Revoke the old token BEFORE issuing a new one — if issuance fails
    // partway through, we fail closed (old token dead, no new token)
    // rather than fail open (old token still valid).
    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    const tokens = await this.issueTokens(storedToken.user);

    return { ...tokens, user: storedToken.user };
  }

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashToken(rawRefreshToken);

    // Not throwing if the token doesn't exist/is already revoked — logout
    // should be idempotent from the client's perspective. Whether this
    // was a valid session or not, the end state the client wants
    // ("I am now logged out") is achieved either way.
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // Revokes ALL of a user's refresh tokens — used after a password reset,
  // since a password change should invalidate every existing session, not
  // just the one that performed the reset (e.g. if the reset was
  // triggered because credentials were compromised, this kicks out
  // whoever else might be logged in).
  async revokeAllRefreshTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // Called from AuthController's Google callback handler. By this point,
  // GoogleStrategy.validate() has already resolved (created or linked) the
  // User — this method's only job is issuing the same access/refresh
  // token pair signup/login would produce, so downstream client handling
  // (storing the access token, receiving the refresh cookie) is identical
  // regardless of which auth method was used.
  async issueTokensForOAuthLogin(user: User): Promise<IssuedTokens> {
    return this.issueTokens(user);
  }

  private async issueTokens(user: User): Promise<IssuedTokens> {
    const payload: JwtPayload = { sub: user.id };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.authConfig.jwtAccessSecret,
      expiresIn: this.authConfig.jwtAccessExpiresIn,
    });

    const rawRefreshToken = generateOpaqueToken();
    const refreshTokenExpiresAt = this.computeExpiryDate(
      this.authConfig.jwtRefreshExpiresIn,
    );

    await this.prisma.refreshToken.create({
      data: {
        tokenHash: hashToken(rawRefreshToken),
        userId: user.id,
        expiresAt: refreshTokenExpiresAt,
      },
    });

    return { accessToken, rawRefreshToken, refreshTokenExpiresAt };
  }

  // Parses simple duration strings like "15m", "7d", "1h" into a Date.
  // Kept intentionally small (only the units we actually use in
  // .env.example) rather than pulling in a full duration-parsing library
  // for three cases.
  private computeExpiryDate(duration: string): Date {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) {
      throw new Error(
        `Invalid duration format: "${duration}". Expected e.g. "15m", "7d".`,
      );
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];
    const unitToMs: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return new Date(Date.now() + value * unitToMs[unit]);
  }
}
