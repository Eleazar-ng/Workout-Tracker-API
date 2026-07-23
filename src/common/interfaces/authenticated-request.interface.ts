import type { Request } from 'express';
import type { User } from 'generated/prisma/client';

// Explicit, local extension of Express's Request — rather than relying on
// global declaration merging (augmenting the ambient `Express.User`
// namespace), we just define the shape we actually need and use it
// directly wherever a route handler expects an authenticated request.
//
// Why this approach instead of ambient module augmentation: global
// declaration merging depends on TypeScript resolving and merging
// multiple .d.ts files across the dependency graph in a specific order,
// which can silently fail to apply depending on module resolution
// settings, duplicate @types packages in the dependency tree, or editor/
// language-server caching — and when it fails, the error message gives
// no indication that a global augmentation was even involved, making it
// hard to debug. An explicit interface has no such failure mode: if this
// type is imported and used, it works, full stop.
//
// `user` is NON-OPTIONAL here (unlike Passport's own `Express.Request.user
// ?: User`), because this type is only ever used on routes that are
// guaranteed to already be authenticated (i.e. sit behind JwtAuthGuard, or
// are reached via a Passport strategy's callback after a successful
// auth) — by the time a handler sees this type, a user is expected to be
// present.
export interface AuthenticatedRequest extends Request {
  user: User;
}