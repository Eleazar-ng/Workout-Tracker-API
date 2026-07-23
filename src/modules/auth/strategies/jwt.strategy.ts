import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { AuthConfig } from '../../../config/configuration';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    const authConfig = configService.get<AuthConfig>('auth')!;
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: authConfig.jwtAccessSecret,
    });
  }

  // Called automatically by Passport once the JWT signature/expiry check
  // passes. Whatever this returns becomes `request.user`. We re-fetch the
  // user from the DB (rather than trusting the token payload alone) so
  // that e.g. a user deleted after their token was issued is correctly
  // rejected, and so downstream guards (like the email-verification check
  // in JwtAuthGuard) have fresh data to check against.
  async validate(payload: JwtPayload) {
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    return user;
  }
}
