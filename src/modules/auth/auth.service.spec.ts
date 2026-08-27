import { Test } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { DeepMockProxy } from 'jest-mock-extended';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createMockPrismaService,
  resetMockPrismaService,
} from '../../test-utils/mock-prisma';
import { User } from 'generated/prisma/client';

// argon2's `hash` export comes from a native (N-API) binding and is
// non-configurable — jest.spyOn(argon2, 'hash') fails at runtime with
// "Cannot redefine property" because spyOn needs to redefine the
// property descriptor, which native bindings don't allow. Wrapping it
// as a jest.fn() AROUND the real implementation (via jest.requireActual)
// sidesteps this: real hashing/verification behavior is preserved for
// every test that needs it, while still making `argon2.hash` a genuine
// jest mock whose calls can be asserted on.
jest.mock('argon2', () => {
  const actual = jest.requireActual<typeof argon2>('argon2');
  return {
    ...actual,
    hash: jest.fn(actual.hash),
  };
});

describe('AuthService', () => {
  let service: AuthService;
  let prisma: DeepMockProxy<PrismaService>;
  let usersService: jest.Mocked<
    Pick<UsersService, 'findByEmail' | 'createLocalUser' | 'toResponseDto'>
  >;
  let jwtService: jest.Mocked<Pick<JwtService, 'signAsync'>>;

  // A stand-in AuthConfig — matches what ConfigService.get('auth') returns
  // in the real app (see configuration.ts). Durations use the real
  // "15m"/"7d" format since AuthService parses them itself
  // (computeExpiryDate) — a malformed value here would surface as a
  // genuine test failure, which is intentional.
  const mockAuthConfig = {
    jwtAccessSecret: 'test-access-secret-at-least-32-characters-long',
    jwtRefreshSecret: 'test-refresh-secret-at-least-32-characters-long',
    jwtAccessExpiresIn: '15m',
    jwtRefreshExpiresIn: '7d',
    google: {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      callbackUrl: 'http://localhost:3000/auth/google/callback',
    },
  };

  const buildUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'user-1',
      email: 'test@example.com',
      passwordHash: null,
      firstName: 'Test',
      lastName: 'User',
      emailVerifiedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    }) as User;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    usersService = {
      findByEmail: jest.fn(),
      createLocalUser: jest.fn(),
      toResponseDto: jest.fn((user: User) => ({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        emailVerifiedAt: user.emailVerifiedAt,
        createdAt: user.createdAt,
      })),
    };
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed.jwt.token'),
    };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(mockAuthConfig) },
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  afterEach(() => {
    resetMockPrismaService(prisma);
    jest.clearAllMocks();
  });

  describe('signup', () => {
    it('throws ConflictException when the email is already registered', async () => {
      usersService.findByEmail.mockResolvedValue(buildUser());

      await expect(
        service.signup({
          email: 'test@example.com',
          password: 'Password123',
          firstName: 'A',
          lastName: 'B',
        }),
      ).rejects.toThrow(ConflictException);

      // Must fail BEFORE ever attempting to create a user or hash a
      // password — no partial side effects on a rejected signup.
      expect(usersService.createLocalUser).not.toHaveBeenCalled();
    });

    it('hashes the password with argon2 before storing it (never stores plaintext)', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      const createdUser = buildUser({
        passwordHash: 'irrelevant-for-this-test',
      });
      usersService.createLocalUser.mockResolvedValue(createdUser);
      prisma.refreshToken.create.mockResolvedValue({} as never);

      await service.signup({
        email: 'test@example.com',
        password: 'Password123',
        firstName: 'A',
        lastName: 'B',
      });

      const [[createInput]] = usersService.createLocalUser.mock.calls;
      expect(createInput.passwordHash).not.toBe('Password123');
      // A real argon2 hash always starts with this identifier prefix.
      expect(createInput.passwordHash).toMatch(/^\$argon2/);
    });

    it('issues tokens and returns a safe user shape (no passwordHash) on success', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      const createdUser = buildUser();
      usersService.createLocalUser.mockResolvedValue(createdUser);
      prisma.refreshToken.create.mockResolvedValue({} as never);

      const result = await service.signup({
        email: 'test@example.com',
        password: 'Password123',
        firstName: 'A',
        lastName: 'B',
      });

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.rawRefreshToken).toMatch(/^[0-9a-f]{64}$/);
      expect(result.refreshTokenExpiresAt).toBeInstanceOf(Date);
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    });

    it('throws a clear error if the configured token duration format is malformed', async () => {
      // Defensive branch: computeExpiryDate expects "15m"/"7d"-style
      // strings (enforced by env.validation.ts's Zod regex in the real
      // app), but this verifies the service itself fails loudly — rather
      // than silently producing a broken expiry — if that guarantee is
      // ever violated (e.g. a future config refactor bypasses validation).
      const module = await Test.createTestingModule({
        providers: [
          AuthService,
          { provide: PrismaService, useValue: prisma },
          { provide: UsersService, useValue: usersService },
          { provide: JwtService, useValue: jwtService },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue({
                ...mockAuthConfig,
                jwtRefreshExpiresIn: 'not-a-valid-duration',
              }),
            },
          },
        ],
      }).compile();
      const serviceWithBadConfig = module.get(AuthService);

      usersService.findByEmail.mockResolvedValue(null);
      usersService.createLocalUser.mockResolvedValue(buildUser());

      await expect(
        serviceWithBadConfig.signup({
          email: 'test@example.com',
          password: 'Password123',
          firstName: 'A',
          lastName: 'B',
        }),
      ).rejects.toThrow(/Invalid duration format/);
    });
  });

  describe('login', () => {
    it('throws UnauthorizedException with a generic message when the user does not exist', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'whatever' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('still performs an argon2 hash when the user does not exist (timing-attack mitigation)', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'whatever' }),
      ).rejects.toThrow(UnauthorizedException);

      // Per auth.service.ts: a dummy hash is computed even when there's no
      // user to check against, specifically so this code path doesn't
      // resolve measurably faster than the "wrong password" path.
      expect(argon2.hash).toHaveBeenCalledWith(
        'dummy-value-to-equalize-timing',
      );
    });

    it('throws UnauthorizedException when the user has no password (OAuth-only account)', async () => {
      usersService.findByEmail.mockResolvedValue(
        buildUser({ passwordHash: null }),
      );

      await expect(
        service.login({ email: 'test@example.com', password: 'whatever' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when the password is wrong', async () => {
      const realHash = await argon2.hash('correct-password');
      usersService.findByEmail.mockResolvedValue(
        buildUser({ passwordHash: realHash }),
      );

      await expect(
        service.login({
          email: 'test@example.com',
          password: 'wrong-password',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('issues tokens when the password is correct', async () => {
      const realHash = await argon2.hash('correct-password');
      usersService.findByEmail.mockResolvedValue(
        buildUser({ passwordHash: realHash }),
      );
      prisma.refreshToken.create.mockResolvedValue({} as never);

      const result = await service.login({
        email: 'test@example.com',
        password: 'correct-password',
      });

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.user).not.toHaveProperty('passwordHash');
    });
  });

  describe('refresh', () => {
    const rawToken = 'raw-refresh-token-value';

    it('throws UnauthorizedException when the token does not exist', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refresh(rawToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when the token was already revoked', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        tokenHash: 'hash',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 100000),
        revokedAt: new Date(), // already revoked
        createdAt: new Date(),
        user: buildUser(),
      } as never);

      await expect(service.refresh(rawToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when the token has expired', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        tokenHash: 'hash',
        userId: 'user-1',
        expiresAt: new Date(Date.now() - 1000), // in the past
        revokedAt: null,
        createdAt: new Date(),
        user: buildUser(),
      } as never);

      await expect(service.refresh(rawToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('revokes the old token BEFORE issuing a new one (fail-closed ordering)', async () => {
      const user = buildUser();
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        tokenHash: 'hash',
        userId: user.id,
        expiresAt: new Date(Date.now() + 100000),
        revokedAt: null,
        createdAt: new Date(),
        user,
      } as never);

      const callOrder: string[] = [];
      prisma.refreshToken.update.mockImplementation((async () => {
        callOrder.push('revoke-old');
        return {} as never;
      }) as never);
      prisma.refreshToken.create.mockImplementation((async () => {
        callOrder.push('create-new');
        return {} as never;
      }) as never);

      await service.refresh(rawToken);

      expect(callOrder).toEqual(['revoke-old', 'create-new']);
    });

    it('returns a new access token, new refresh token, and the associated user', async () => {
      const user = buildUser();
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        tokenHash: 'hash',
        userId: user.id,
        expiresAt: new Date(Date.now() + 100000),
        revokedAt: null,
        createdAt: new Date(),
        user,
      } as never);
      prisma.refreshToken.update.mockResolvedValue({} as never);
      prisma.refreshToken.create.mockResolvedValue({} as never);

      const result = await service.refresh(rawToken);

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.rawRefreshToken).toMatch(/^[0-9a-f]{64}$/);
      expect(result.user).toBe(user);
    });
  });

  describe('logout', () => {
    it('revokes only the matching, not-already-revoked token', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await service.logout('raw-token');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { tokenHash: expect.any(String), revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('does not throw when no matching token exists (idempotent logout)', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.logout('nonexistent-token'),
      ).resolves.toBeUndefined();
    });
  });

  describe('revokeAllRefreshTokens', () => {
    it('revokes every non-revoked token for the given user', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });

      await service.revokeAllRefreshTokens('user-1');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('issueTokensForOAuthLogin', () => {
    it('issues the same shape of tokens as signup/login', async () => {
      const user = buildUser();
      prisma.refreshToken.create.mockResolvedValue({} as never);

      const result = await service.issueTokensForOAuthLogin(user);

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.rawRefreshToken).toMatch(/^[0-9a-f]{64}$/);
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    });
  });
});
