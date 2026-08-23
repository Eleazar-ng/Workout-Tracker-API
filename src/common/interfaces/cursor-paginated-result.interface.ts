// Replaces PaginatedResult<T> (page/limit/total/totalPages). Deliberately
// has NO `total` field — computing an exact total count requires a full
// COUNT query, which partially defeats the performance benefit keyset
// pagination is meant to provide, and isn't needed to page through
// results correctly. This matches how most real-world cursor-paginated
// APIs behave (e.g. Stripe's list endpoints don't return a total either).
// If a UI genuinely needs a total count somewhere, that should be a
// separate, explicit count endpoint — not bundled into every page fetch.
export interface CursorPaginatedResult<T> {
  data: T[];
  meta: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}
