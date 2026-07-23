import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { UsersService } from 'src/modules/users/users.service';
import { AuthConfig } from '../../../config/configuration';
import { User } from 'generated/prisma/client';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {
    const authConfig = configService.get<AuthConfig>('auth')!;
    super({
      clientID: authConfig.google.clientId,
      clientSecret: authConfig.google.clientSecret,
      callbackURL: authConfig.google.callbackUrl,
      scope: ['email', 'profile'],
    });
  }

  // Called by Passport once Google redirects back with a successful auth.
  // `profile` contains the verified Google account info; there is no
  // password involved at any point in this flow.
  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    const googleId = profile.id;
    const email = profile.emails?.[0]?.value;

    if (!email) {
      return done(
        new Error('Google account has no email address'),
        undefined,
      );
    }

    // Look up by (provider, providerUserId) FIRST, not by email — this is
    // the durable identity link. Falling back to email lookup below only
    // matters for the one-time "link an existing local account" case.
    const existingIdentity = await this.prisma.authIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: 'GOOGLE',
          providerUserId: googleId,
        },
      },
      include: { user: true },
    });

    if (existingIdentity) {
      return done(null, existingIdentity.user);
    }

    // No existing Google identity — check if a local account already
    // exists with this email (e.g. the user originally signed up with
    // email/password and is now linking Google). If so, ATTACH the
    // AuthIdentity to that existing user rather than creating a duplicate
    // account under the same email, which our unique constraint on
    // User.email would reject anyway.
    let user: User | null = await this.usersService.findByEmail(email);

    if (!user) {
      user = await this.usersService.createOAuthUser({
        email,
        firstName: profile.name?.givenName ?? 'Unknown',
        lastName: profile.name?.familyName ?? '',
      });
    }

    await this.prisma.authIdentity.create({
      data: {
        provider: 'GOOGLE',
        providerUserId: googleId,
        userId: user.id,
      },
    });

    done(null, user);
  }
}
