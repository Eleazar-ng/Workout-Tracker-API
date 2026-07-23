

import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { User } from 'generated/prisma/client';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ALLOW_UNVERIFIED_KEY } from '../decorators/allow-unverified.decorator';

// user is OPTIONAL here (unlike AuthenticatedRequest, used elsewhere for
// routes already known to be authenticated) — this guard is precisely the
// code that determines whether a user is present, so at the point we
// first read request.user, it genuinely may still be undefined.
interface RequestWithOptionalUser extends Request {
  user?: User;
}

// Applied globally as APP_GUARD in AuthModule — every route is protected
// by default (secure-by-default), and individual routes opt OUT via
// @Public() or @AllowUnverified(), rather than every module having to
// remember to opt IN to protection. This is a deliberate safety choice:
// forgetting to add a guard to a new route is a much easier mistake to
// make than forgetting to add @Public() to a route that's meant to be
// open — and the failure mode of the former (an accidentally-open
// endpoint) is far worse than the latter (an accidentally-protected one,
// which just throws an obvious 401 during testing).
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) {
      return true;
    }

    // Runs Passport's JWT strategy (signature + expiry check, then
    // JwtStrategy.validate() to load the user) via the parent AuthGuard.
    // Throws UnauthorizedException automatically if the token is
    // missing/invalid/expired.
    const isAuthenticated = await super.canActivate(context);
    if (!isAuthenticated) {
      return false;
    }

    const allowUnverified = this.reflector.getAllAndOverride<boolean>(
      ALLOW_UNVERIFIED_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest<RequestWithOptionalUser>();

    // super.canActivate() having returned true guarantees Passport ran
    // JwtStrategy.validate() and attached a user — this check exists for
    // the same defense-in-depth reason as CurrentUser's: if it's ever
    // false here, that's a bug in the guard/strategy wiring, not a normal
    // "unauthenticated" case (that path already returned false above).
    if (!request.user) {
      throw new InternalServerErrorException(
        'JwtAuthGuard: request.user missing after successful authentication',
      );
    }

    if (!allowUnverified && !request.user.emailVerifiedAt) {
      // 403, not 401: the user IS authenticated (we know who they are),
      // they're just not yet AUTHORIZED for this resource. Conflating
      // these would make it harder for a client to distinguish "log in
      // again" from "go verify your email" and react accordingly.
      throw new ForbiddenException(
        'Please verify your email address to access this resource',
      );
    }

    return true;
  }
}




































// import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
// import { AuthGuard } from '@nestjs/passport';
// import { Reflector } from '@nestjs/core';
// import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
// import { ALLOW_UNVERIFIED_KEY } from '../decorators/allow-unverified.decorator';
// import { User } from 'generated/prisma/client';

// // Applied globally as APP_GUARD in AuthModule — every route is protected
// // by default (secure-by-default), and individual routes opt OUT via
// // @Public() or @AllowUnverified(), rather than every module having to
// // remember to opt IN to protection. This is a deliberate safety choice:
// // forgetting to add a guard to a new route is a much easier mistake to
// // make than forgetting to add @Public() to a route that's meant to be
// // open — and the failure mode of the former (an accidentally-open
// // endpoint) is far worse than the latter (an accidentally-protected one,
// // which just throws an obvious 401 during testing).
// @Injectable()
// export class JwtAuthGuard extends AuthGuard('jwt') {
//   constructor(private readonly reflector: Reflector) {
//     super();
//   }

//   async canActivate(context: ExecutionContext): Promise<boolean> {
//     const isPublic = this.reflector.getAllAndOverride<boolean>(
//       IS_PUBLIC_KEY,
//       [context.getHandler(), context.getClass()],
//     );
//     if (isPublic) {
//       return true;
//     }

//     // Runs Passport's JWT strategy (signature + expiry check, then
//     // JwtStrategy.validate() to load the user) via the parent AuthGuard.
//     // Throws UnauthorizedException automatically if the token is
//     // missing/invalid/expired.
//     const isAuthenticated = await super.canActivate(context);
//     if (!isAuthenticated) {
//       return false;
//     }

//     const allowUnverified = this.reflector.getAllAndOverride<boolean>(
//       ALLOW_UNVERIFIED_KEY,
//       [context.getHandler(), context.getClass()],
//     );

//     const request = context.switchToHttp().getRequest();
//     const user: User = request.user;

//     if (!allowUnverified && !user.emailVerifiedAt) {
//       // 403, not 401: the user IS authenticated (we know who they are),
//       // they're just not yet AUTHORIZED for this resource. Conflating
//       // these would make it harder for a client to distinguish "log in
//       // again" from "go verify your email" and react accordingly.
//       throw new ForbiddenException(
//         'Please verify your email address to access this resource',
//       );
//     }

//     return true;
//   }
// }
