// The shape of a User that's safe to ever send to a client. Deliberately
// excludes passwordHash — there is no code path where that field should
// leave the server. Kept as an explicit allowlist (rather than "return the
// Prisma User minus a few fields") so that if new sensitive columns are
// added to the User model later, they're excluded by default rather than
// accidentally exposed until someone remembers to strip them.
export class UserResponseDto {
  id!: string;
  email!: string;
  firstName!: string;
  lastName!: string;
  emailVerifiedAt!: Date | null;
  createdAt!: Date;
}
