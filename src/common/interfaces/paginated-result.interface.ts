// Standard envelope every paginated list endpoint returns. Defined once
// here so every module (Exercises now; Programs/Workouts/etc. later)
// produces an identical shape — a client only has to learn this pattern
// once, and it's straightforward to document as a single reusable schema
// in Stage 13's OpenAPI spec.
export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
