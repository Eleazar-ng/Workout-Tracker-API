import {
  ExecutionContext,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ALLOW_UNVERIFIED_KEY } from '../decorators/allow-unverified.decorator';
import { User } from 'generated/prisma/client';

// JwtAuthGuard extends AuthGuard('jwt') (a Passport mixin) and calls
// super.canActivate() internally to run real token verification. For a
// UNIT test, we don't want to exercise Passport's real strategy
// machinery (that would require a live JWT + registered strategy — more
// like an integration test) — instead we spy on the PARENT class's
// canActivate directly, letting us control "did authentication succeed"
// as a simple boolean per test, while still exercising all of
// JwtAuthGuard's OWN logic (the @Public()/@AllowUnverified() checks and
// the verified-email enforcement) for real.
function mockSuperCanActivate(resolvedValue: boolean | Promise<boolean>) {
  return jest
    .spyOn(
      Object.getPrototypeOf(JwtAuthGuard.prototype),
      'canActivate',
    )
    .mockImplementation(() => Promise.resolve(resolvedValue));
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

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

  const createContext = (user?: User): ExecutionContext => {
    const request: { user?: User } = { user };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('allows access to a @Public() route WITHOUT running authentication at all', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key) => key === IS_PUBLIC_KEY);
    const superSpy = mockSuperCanActivate(true);

    const result = await guard.canActivate(createContext());

    expect(result).toBe(true);
    // The whole point of @Public(): Passport's real authentication logic
    // must never even run for these routes.
    expect(superSpy).not.toHaveBeenCalled();
  });

  it('returns false when Passport authentication itself fails (invalid/missing token)', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    mockSuperCanActivate(false);

    const result = await guard.canActivate(createContext());

    expect(result).toBe(false);
  });

  it('throws InternalServerErrorException if authentication succeeded but no user was attached to the request', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    mockSuperCanActivate(true);

    // No user passed — simulates a misconfigured strategy that resolves
    // successfully without attaching req.user, which should never
    // silently pass through.
    await expect(guard.canActivate(createContext(undefined))).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('throws ForbiddenException for an authenticated but UNVERIFIED user on a normal route', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === ALLOW_UNVERIFIED_KEY) return false;
      return false;
    });
    mockSuperCanActivate(true);

    const context = createContext(buildUser({ emailVerifiedAt: null }));

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows an UNVERIFIED user through when the route has @AllowUnverified()', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === ALLOW_UNVERIFIED_KEY) return true;
      return false;
    });
    mockSuperCanActivate(true);

    const context = createContext(buildUser({ emailVerifiedAt: null }));
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('allows a VERIFIED user through on a normal route', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === ALLOW_UNVERIFIED_KEY) return false;
      return false;
    });
    mockSuperCanActivate(true);

    const context = createContext(buildUser({ emailVerifiedAt: new Date() }));
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
  });
});