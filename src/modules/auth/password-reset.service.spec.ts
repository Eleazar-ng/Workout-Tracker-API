import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeepMockProxy } from 'jest-mock-extended';
import { PasswordResetService } from './password-reset.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createMockPrismaService,
  resetMockPrismaService,
} from '../../test-utils/mock-prisma';
import { User } from 'generated/prisma/client';

describe('PasswordResetService', () => {
  let service: PasswordResetService;
  let prisma: DeepMockProxy<PrismaService>;
  let usersService: jest.Mocked<Pick<UsersService, 'findByEmail'>>;
  let mailService: jest.Mocked<Pick<MailService, 'sendPasswordResetEmail'>>;
  let authService: jest.Mocked<Pick<AuthService, 'revokeAllRefreshTokens'>>;

  const buildUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'user-1',
      email: 'test@example.com',
      passwordHash: 'existing-hash',
      firstName: 'Test',
      lastName: 'User',
      emailVerifiedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as User;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    prisma.$transaction.mockImplementation(
      (ops) => Promise.all(ops as never) as never,
    );

    usersService = { findByEmail: jest.fn() };
    mailService = {
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    };
    authService = {
      revokeAllRefreshTokens: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: MailService, useValue: mailService },
        { provide: AuthService, useValue: authService },
        {
          provide: ConfigService,
          useValue: {
            get: jest
              .fn()
              .mockReturnValue({ baseUrl: 'http://localhost:3000' }),
          },
        },
      ],
    }).compile();

    service = module.get(PasswordResetService);
  });

  afterEach(() => {
    resetMockPrismaService(prisma);
    jest.clearAllMocks();
  });

  describe('requestReset', () => {
    it('does nothing when no user exists for the email (enumeration prevention)', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await service.requestReset('nobody@example.com');

      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('does nothing for an OAuth-only user with no password (enumeration prevention)', async () => {
      usersService.findByEmail.mockResolvedValue(
        buildUser({ passwordHash: null }),
      );

      await service.requestReset('oauth-user@example.com');

      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('creates a token and sends an email for a valid local-account user', async () => {
      const user = buildUser();
      usersService.findByEmail.mockResolvedValue(user);
      prisma.passwordResetToken.create.mockResolvedValue({} as never);

      await service.requestReset('test@example.com');

      expect(prisma.passwordResetToken.create).toHaveBeenCalledWith({
        data: {
          tokenHash: expect.any(String),
          userId: user.id,
          expiresAt: expect.any(Date),
        },
      });

      const [[to, link]] = mailService.sendPasswordResetEmail.mock.calls;
      expect(to).toBe(user.email);
      expect(link).toContain(
        'http://localhost:3000/auth/reset-password?token=',
      );
    });

    it('sets a 30-minute expiry — deliberately shorter than email verification', async () => {
      usersService.findByEmail.mockResolvedValue(buildUser());
      prisma.passwordResetToken.create.mockResolvedValue({} as never);

      await service.requestReset('test@example.com');

      const [[{ data }]] = prisma.passwordResetToken.create.mock.calls;
      const expiresAt = (data as { expiresAt: Date }).expiresAt;
      const expectedMs = 30 * 60 * 1000;
      const actualMs = expiresAt.getTime() - Date.now();

      expect(actualMs).toBeGreaterThan(expectedMs - 5000);
      expect(actualMs).toBeLessThanOrEqual(expectedMs);
    });
  });

  describe('confirmReset', () => {
    it('throws BadRequestException when the token does not exist', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.confirmReset('raw-token', 'NewPassword123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the token was already used', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        tokenHash: 'hash',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 100000),
        usedAt: new Date(),
        createdAt: new Date(),
      } as never);

      await expect(
        service.confirmReset('raw-token', 'NewPassword123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the token has expired', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        tokenHash: 'hash',
        userId: 'user-1',
        expiresAt: new Date(Date.now() - 1000),
        usedAt: null,
        createdAt: new Date(),
      } as never);

      await expect(
        service.confirmReset('raw-token', 'NewPassword123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not call revokeAllRefreshTokens when the token is invalid', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.confirmReset('raw-token', 'NewPassword123'),
      ).rejects.toThrow(BadRequestException);

      expect(authService.revokeAllRefreshTokens).not.toHaveBeenCalled();
    });

    it('hashes the new password, persists it, marks the token used, and revokes all sessions on success', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        tokenHash: 'hash',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 100000),
        usedAt: null,
        createdAt: new Date(),
      } as never);
      prisma.passwordResetToken.update.mockResolvedValue({} as never);
      prisma.user.update.mockResolvedValue({} as never);

      await service.confirmReset('raw-token', 'NewPassword123');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
        where: { id: 'prt-1' },
        data: { usedAt: expect.any(Date) },
      });

      const [[{ data }]] = prisma.user.update.mock.calls;
      const { passwordHash } = data as { passwordHash: string };
      expect(passwordHash).not.toBe('NewPassword123');
      expect(passwordHash).toMatch(/^\$argon2/);

      expect(authService.revokeAllRefreshTokens).toHaveBeenCalledWith(
        'user-1',
      );
    });

    it('revokes sessions AFTER the transaction commits, not before', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        tokenHash: 'hash',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 100000),
        usedAt: null,
        createdAt: new Date(),
      } as never);

      const callOrder: string[] = [];
      prisma.$transaction.mockImplementation((async (ops: unknown) => {
        callOrder.push('transaction-committed');
        return Promise.all(ops as never);
      }) as never);
      authService.revokeAllRefreshTokens.mockImplementation(async () => {
        callOrder.push('sessions-revoked');
      });
      prisma.passwordResetToken.update.mockResolvedValue({} as never);
      prisma.user.update.mockResolvedValue({} as never);

      await service.confirmReset('raw-token', 'NewPassword123');

      expect(callOrder).toEqual([
        'transaction-committed',
        'sessions-revoked',
      ]);
    });
  });
});
