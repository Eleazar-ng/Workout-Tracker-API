import { DeepMockProxy, mockDeep, mockReset } from 'jest-mock-extended';
import { PrismaService } from '../prisma/prisma.service';

// A DEEP mock — every model delegate (prisma.user, prisma.workout, etc.)
// and every method on each (findMany, create, update, ...) is
// automatically a jest.fn(), fully typed against PrismaService's actual
// shape. This is the standard approach for testing NestJS services that
// depend on Prisma: it avoids hand-writing (and maintaining) a giant
// mock object literal covering every method of every model by hand,
// which would be enormous and easy to let drift out of sync with the
// real schema.
//
// Usage in a test file:
//
//   let prisma: DeepMockProxy<PrismaService>;
//
//   beforeEach(() => {
//     prisma = createMockPrismaService();
//     const module = await Test.createTestingModule({
//       providers: [
//         SomeService,
//         { provide: PrismaService, useValue: prisma },
//       ],
//     }).compile();
//   });
//
// Then configure return values per-test:
//   prisma.program.findFirst.mockResolvedValue(someProgram);
//
// NOTE on $transaction: Prisma supports two call styles, and mockDeep
// does NOT know which one a given test needs, since $transaction itself
// is just mocked as a plain jest.fn() returning undefined by default.
// Configure it per-test-suite based on which style the code under test
// actually uses:
//
//   Array style (e.g. EmailVerificationService, PasswordResetService):
//     prisma.$transaction.mockImplementation(
//       (ops) => Promise.all(ops) as any,
//     );
//
//   Interactive callback style (none of our services currently use this,
//   but if one did):
//     prisma.$transaction.mockImplementation((fn) => fn(prisma));
export function createMockPrismaService(): DeepMockProxy<PrismaService> {
  return mockDeep<PrismaService>();
}

// Call in afterEach() to reset all mock call history and configured
// return values between tests — without this, a mockResolvedValue set in
// one test would leak into the next test's assertions, since the same
// mock object would otherwise be reused across the whole suite.
export function resetMockPrismaService(
  mock: DeepMockProxy<PrismaService>,
): void {
  mockReset(mock);
}
