import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeepMockProxy } from 'jest-mock-extended';
import { EmailVerificationService } from './email-verification.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createMockPrismaService,
  resetMockPrismaService,
} from '../../test-utils/mock-prisma';
import { User } from 'generated/prisma/client';

describe('EmailVerificationService', () => {
  let service: EmailVerificationService;
  let prisma: DeepMockProxy<PrismaService>;
  let usersService: jest.Mocked<Pick<UsersService, 'findById'>>;
  let mailService: jest.Mocked<Pick<MailService, 'sendVerificationEmail'>>;

  const buildUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'user-1',
      email: 'test@example.com',
      passwordHash: 'hash',
      firstName: 'Test',
      lastName: 'User',
      emailVerifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as User;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    // Array-style $transaction, per the note in mock-prisma.ts —
    // confirmVerification calls $transaction([update, update]).
    prisma.$transaction.mockImplementation(
      (ops) => Promise.all(ops as never) as never,
    );

    usersService = { findById: jest.fn() };
    mailService = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        EmailVerificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: MailService, useValue: mailService },
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

    service = module.get(EmailVerificationService);
  });

  afterEach(() => {
    resetMockPrismaService(prisma);
    jest.clearAllMocks();
  });

  describe('issueVerificationToken', () => {
    it('creates a token record and sends an email containing the link', async () => {
      prisma.emailVerificationToken.create.mockResolvedValue({} as never);

      await service.issueVerificationToken('user-1', 'test@example.com');

      expect(prisma.emailVerificationToken.create).toHaveBeenCalledWith({
        data: {
          tokenHash: expect.any(String),
          userId: 'user-1',
          expiresAt: expect.any(Date),
        },
      });

      const [[to, link]] = mailService.sendVerificationEmail.mock.calls;
      expect(to).toBe('test@example.com');
      expect(link).toContain(
        'http://localhost:3000/auth/verify-email?token=',
      );
    });

    it('sets an expiry roughly 24 hours in the future', async () => {
      prisma.emailVerificationToken.create.mockResolvedValue({} as never);

      await service.issueVerificationToken('user-1', 'test@example.com');

      const [[{ data }]] = prisma.emailVerificationToken.create.mock.calls;
      const expiresAt = (data as { expiresAt: Date }).expiresAt;
      const expectedMs = 24 * 60 * 60 * 1000;
      const actualMs = expiresAt.getTime() - Date.now();

      // Allow a small tolerance for test execution time.
      expect(actualMs).toBeGreaterThan(expectedMs - 5000);
      expect(actualMs).toBeLessThanOrEqual(expectedMs);
    });
  });

  describe('resendVerification', () => {
    it('throws BadRequestException when the user does not exist', async () => {
      usersService.findById.mockResolvedValue(null);

      await expect(service.resendVerification('nonexistent')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the email is already verified', async () => {
      usersService.findById.mockResolvedValue(
        buildUser({ emailVerifiedAt: new Date() }),
      );

      await expect(service.resendVerification('user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('issues a new token when the user exists and is unverified', async () => {
      usersService.findById.mockResolvedValue(
        buildUser({ emailVerifiedAt: null }),
      );
      prisma.emailVerificationToken.create.mockResolvedValue({} as never);

      await service.resendVerification('user-1');

      expect(prisma.emailVerificationToken.create).toHaveBeenCalledTimes(1);
      expect(mailService.sendVerificationEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe('confirmVerification', () => {
    it('throws BadRequestException when the token does not exist', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue(null);

      await expect(service.confirmVerification('raw-token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the token was already used', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'evt-1',
        tokenHash: 'hash',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 100000),
        usedAt: new Date(), // already used
        createdAt: new Date(),
      } as never);

      await expect(service.confirmVerification('raw-token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the token has expired', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'evt-1',
        tokenHash: 'hash',
        userId: 'user-1',
        expiresAt: new Date(Date.now() - 1000), // expired
        usedAt: null,
        createdAt: new Date(),
      } as never);

      await expect(service.confirmVerification('raw-token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('marks the token used and verifies the user in one transaction on success', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'evt-1',
        tokenHash: 'hash',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 100000),
        usedAt: null,
        createdAt: new Date(),
      } as never);
      prisma.emailVerificationToken.update.mockResolvedValue({} as never);
      prisma.user.update.mockResolvedValue({} as never);

      await service.confirmVerification('raw-token');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.emailVerificationToken.update).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
        data: { usedAt: expect.any(Date) },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { emailVerifiedAt: expect.any(Date) },
      });
    });
  });
});
