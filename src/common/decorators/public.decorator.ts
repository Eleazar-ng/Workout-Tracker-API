import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Marks a route handler as exempt from the global JwtAuthGuard (see
// common/guards/jwt-auth.guard.ts, which is applied APP_GUARD-wide). Used
// on signup/login/refresh/OAuth routes — anything reachable without
// already having a valid token.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
