export const REFRESH_TOKEN_COOKIE_NAME = 'refresh_token';

// Centralized so AuthController's login/signup/refresh (which SET this
// cookie) and logout (which CLEARS it) can't drift out of sync on
// attributes like path or sameSite — mismatched clear-cookie attributes
// are a classic source of "logout doesn't actually clear the cookie" bugs.
export function getRefreshTokenCookieOptions(
  isProduction: boolean,
  maxAgeMs?: number,
) {
  return {
    httpOnly: true, // never readable by client-side JS — the core XSS mitigation
    secure: isProduction, // only sent over HTTPS in production; relaxed in local dev
    sameSite: 'strict' as const, // primary CSRF mitigation — see Stage 4 discussion
    path: '/auth', // only sent to auth endpoints, not the whole API surface
    ...(maxAgeMs !== undefined && { maxAge: maxAgeMs }),
  };
}
