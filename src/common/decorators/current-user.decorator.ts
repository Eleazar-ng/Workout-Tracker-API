import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import { User } from 'generated/prisma/client';
import type { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

// Usage: someHandler(@CurrentUser() user: User) — pulls the user object
// that JwtStrategy.validate() attached to the request, so route handlers
// never have to reach into `request.user` manually or know how it got
// there.
//
// Typed via AuthenticatedRequest (an explicit local interface — see
// authenticated-request.interface.ts) rather than relying on global
// declaration merging of Express.Request.user, which proved fragile
// across environments.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();

    // request.user is technically optional at the Express/Passport level
    // (Passport doesn't guarantee it's set) — but @CurrentUser() should
    // only ever be used on routes already sitting behind JwtAuthGuard,
    // which populates it or rejects the request first. If it's missing
    // here, that's a real bug (e.g. someone used @CurrentUser() on a
    // @Public() route), not a valid "no user" case — so we fail loudly
    // rather than silently casting past the gap.
    if (!request.user) {
      throw new InternalServerErrorException(
        '@CurrentUser() used on a route with no authenticated user — check that JwtAuthGuard runs on this route.',
      );
    }

    return request.user;
  },
);





















// import { createParamDecorator, ExecutionContext, InternalServerErrorException } from '@nestjs/common';
// import { User } from 'generated/prisma/client';

// // Usage: someHandler(@CurrentUser() user: User) — pulls the user object
// // that JwtStrategy.validate() attached to the request, so route handlers
// // never have to reach into `request.user` manually or know how it got
// // there.
// export const CurrentUser = createParamDecorator(
//   (_data: unknown, ctx: ExecutionContext): User => {
//     const request = ctx.switchToHttp().getRequest();
//     return request.user;
//   },
// );
