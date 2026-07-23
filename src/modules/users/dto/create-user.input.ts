// Internal shape used between AuthService and UsersService when creating a
// user via local signup. Not a class-validator DTO — validation of the
// raw signup request happens in AuthModule's SignupDto; by the time this
// reaches UsersService, the data has already been validated and the
// password has already been hashed by AuthService (UsersService should
// never see a plaintext password).
export interface CreateLocalUserInput {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
}

// Used when creating a user via Google OAuth — no password at all, and
// the email is considered pre-verified since Google already verified it.
export interface CreateOAuthUserInput {
  email: string;
  firstName: string;
  lastName: string;
}
