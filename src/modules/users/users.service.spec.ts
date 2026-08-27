import { Test } from '@nestjs/testing';
import { DeepMockProxy } from 'jest-mock-extended';
import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createMockPrismaService,
  resetMockPrismaService,
} from '../../test-utils/mock-prisma';
import { User } from 'generated/prisma/client';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: DeepMockProxy<PrismaService>;

  const buildUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'user-1',
      email: 'test@example.com',
      passwordHash: 'super-secret-hash',
      firstName: 'Test',
      lastName: 'User',
      emailVerifiedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    }) as User;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(UsersService);
  });

  afterEach(() => {
    resetMockPrismaService(prisma);
  });

  describe('findByEmail', () => {
    it('queries by email', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());

      await service.findByEmail('test@example.com');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
    });

    it('returns null when no user matches', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.findByEmail('nobody@example.com');

      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('queries by id', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());

      await service.findById('user-1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
    });
  });

  describe('createLocalUser', () => {
    it('creates a user WITHOUT setting emailVerifiedAt (stays null/default)', async () => {
      prisma.user.create.mockResolvedValue(buildUser());

      await service.createLocalUser({
        email: 'new@example.com',
        passwordHash: 'hashed-value',
        firstName: 'New',
        lastName: 'User',
      });

      const [[{ data }]] = prisma.user.create.mock.calls;
      expect(data).not.toHaveProperty('emailVerifiedAt');
      expect(data).toMatchObject({
        email: 'new@example.com',
        passwordHash: 'hashed-value',
        firstName: 'New',
        lastName: 'User',
      });
    });
  });

  describe('createOAuthUser', () => {
    it('creates a user with emailVerifiedAt set immediately and no passwordHash', async () => {
      prisma.user.create.mockResolvedValue(buildUser());

      await service.createOAuthUser({
        email: 'oauth@example.com',
        firstName: 'OAuth',
        lastName: 'User',
      });

      const [[{ data }]] = prisma.user.create.mock.calls;
      expect(data).not.toHaveProperty('passwordHash');
      expect(
        (data as { emailVerifiedAt: Date }).emailVerifiedAt,
      ).toBeInstanceOf(Date);
    });
  });

  describe('updatePasswordHash', () => {
    it('updates only the passwordHash field for the given user', async () => {
      prisma.user.update.mockResolvedValue(buildUser());

      await service.updatePasswordHash('user-1', 'new-hash');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { passwordHash: 'new-hash' },
      });
    });
  });

  describe('markEmailVerified', () => {
    it('sets emailVerifiedAt to a current timestamp', async () => {
      prisma.user.update.mockResolvedValue(buildUser());

      await service.markEmailVerified('user-1');

      const [[{ data }]] = prisma.user.update.mock.calls;
      expect(
        (data as { emailVerifiedAt: Date }).emailVerifiedAt,
      ).toBeInstanceOf(Date);
    });
  });

  describe('toResponseDto', () => {
    it('never includes passwordHash in the returned shape', () => {
      const user = buildUser({ passwordHash: 'should-never-leak' });

      const dto = service.toResponseDto(user);

      expect(dto).not.toHaveProperty('passwordHash');
    });

    it('returns exactly the expected public fields', () => {
      const user = buildUser();

      const dto = service.toResponseDto(user);

      expect(dto).toEqual({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        emailVerifiedAt: user.emailVerifiedAt,
        createdAt: user.createdAt,
      });
    });
  });
});
