import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

// Standard success envelope: { data: <payload> }. Paired with
// AllExceptionsFilter's { error: {...} } shape — a client can tell success
// from failure just by checking which top-level key is present, without
// needing to inspect the HTTP status code first.
//
// PaginatedResult<T> (see common/interfaces/paginated-result.interface.ts,
// used since Stage 3) already has its own { data, meta } shape. Wrapping
// that in a second { data: ... } layer would produce ugly, pointless
// double-nesting ({ data: { data: [...], meta: {...} } }). Instead: if the
// payload already looks like a PaginatedResult (has both `data` and `meta`
// keys), it's passed through unchanged — it already conforms to the
// envelope contract this interceptor exists to enforce.
@Injectable()
export class TransformResponseInterceptor<T>
  implements NestInterceptor<T, unknown>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<unknown> {
    return next.handle().pipe(
      map((payload) => {
        // No-content responses (204, e.g. logout, follow/unfollow, some
        // deletes) have no body to wrap — wrapping `undefined` as
        // { data: undefined } would attach a body to a response that's
        // supposed to have none.
        if (payload === undefined || payload === null) {
          return payload;
        }

        if (this.isAlreadyEnvelopedPagination(payload)) {
          return payload;
        }

        return { data: payload };
      }),
    );
  }

  private isAlreadyEnvelopedPagination(
    payload: unknown,
  ): payload is { data: unknown; meta: unknown } {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'data' in payload &&
      'meta' in payload
    );
  }
}
