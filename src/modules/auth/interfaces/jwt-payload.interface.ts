// The shape encoded inside our JWT access tokens. Deliberately minimal —
// `sub` (subject, the user id) is the only thing route handlers actually
// need; anything else (email, name, roles) should be fetched fresh from
// the DB when needed rather than trusted from an old token payload, since
// a token can be valid for up to JWT_ACCESS_EXPIRES_IN after the
// underlying user data changes.
export interface JwtPayload {
  sub: string; // user id
}
