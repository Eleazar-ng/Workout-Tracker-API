import { SetMetadata } from '@nestjs/common';

export const ALLOW_UNVERIFIED_KEY = 'allowUnverified';

// By default, JwtAuthGuard requires BOTH a valid token AND a verified
// email (emailVerifiedAt set) — see common/guards/jwt-auth.guard.ts. This
// decorator opts a specific route out of the verification requirement
// while still requiring authentication. Used for routes an unverified-but-
// logged-in user still needs: logout, resend-verification, verify-email,
// and GET /users/me (so the frontend can render "please verify your
// email" state).
export const AllowUnverified = () => SetMetadata(ALLOW_UNVERIFIED_KEY, true);
