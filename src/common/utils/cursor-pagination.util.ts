import { BadRequestException } from '@nestjs/common';

// Keyset (cursor) pagination, not offset (skip/take). Every list endpoint
// in this stage migrates to this pattern. Why: offset pagination
// (skip: N) has two real problems at scale — (1) `skip` gets slower as N
// grows, since the DB still has to walk past N rows even though it
// discards them, and (2) "page drift": if a row is inserted/deleted while
// a user is paging through, results can shift, causing duplicates or
// skipped items between pages. Keyset pagination avoids both: it seeks
// directly to "everything after the last item I saw" using an indexed
// WHERE clause, which is stable regardless of concurrent writes and
// doesn't degrade as the table grows.
//
// A cursor here always encodes TWO things: the sort field's value, and
// the row's id as a tiebreaker. The tiebreaker is what makes this safe
// even when the sort field isn't guaranteed unique (e.g. two Programs
// created in the same millisecond) — without it, rows with a tied sort
// value could be silently skipped or duplicated across pages.

export interface DecodedCursor {
  value: string;
  id: string;
}

export function encodeCursor(value: Date | string, id: string): string {
  const normalizedValue = value instanceof Date ? value.toISOString() : value;
  const payload = JSON.stringify({ value: normalizedValue, id });
  return Buffer.from(payload, 'utf-8').toString('base64url');
}

export function decodeCursor(cursor: string): DecodedCursor {
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf-8'),
    );
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      typeof (decoded as DecodedCursor).value !== 'string' ||
      typeof (decoded as DecodedCursor).id !== 'string'
    ) {
      throw new Error('Malformed cursor payload');
    }
    return decoded as DecodedCursor;
  } catch {
    // A tampered or garbage cursor should read as a normal client error,
    // not crash the request with an unhandled parse exception.
    throw new BadRequestException('Invalid cursor');
  }
}

// Builds the Prisma `OR` clause for a keyset WHERE condition. Given a
// sort direction and a decoded cursor, produces the standard two-branch
// keyset predicate:
//   ASC:  (sortField > cursorValue) OR (sortField = cursorValue AND id > cursorId)
//   DESC: (sortField < cursorValue) OR (sortField = cursorValue AND id < cursorId)
// `sortFieldToPrismaValue` converts the cursor's string-encoded value
// back into whatever type Prisma expects for that field (e.g. a Date for
// DateTime columns) — callers pass this since it's field-specific.
export function buildKeysetWhere<TWhereField extends string>(
  sortField: TWhereField,
  direction: 'asc' | 'desc',
  cursor: DecodedCursor,
  sortFieldToPrismaValue: (value: string) => unknown,
): Record<string, unknown> {
  const comparisonOp = direction === 'asc' ? 'gt' : 'lt';
  const fieldValue = sortFieldToPrismaValue(cursor.value);

  return {
    OR: [
      { [sortField]: { [comparisonOp]: fieldValue } },
      {
        [sortField]: fieldValue,
        id: { [comparisonOp]: cursor.id },
      },
    ],
  };
}

// After fetching `limit + 1` rows ordered by (sortField, id), this
// determines whether there's a next page and builds the cursor for it —
// the classic "fetch one extra" technique, avoiding a separate COUNT
// query just to know if more data exists.
export function paginateKeysetResults<T>(
  items: T[],
  limit: number,
  getSortValue: (item: T) => Date | string,
  getId: (item: T) => string,
): { page: T[]; hasMore: boolean; nextCursor: string | null } {
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const lastItem = page[page.length - 1];

  return {
    page,
    hasMore,
    nextCursor:
      hasMore && lastItem
        ? encodeCursor(getSortValue(lastItem), getId(lastItem))
        : null,
  };
}
