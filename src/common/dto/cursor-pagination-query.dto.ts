import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

// Replaces the old page/limit-based PaginationQueryDto. `cursor` is an
// opaque, base64url-encoded string (see cursor-pagination.util.ts) — its
// internal structure is deliberately not part of the API contract; a
// client should never construct or parse it, only pass back whatever
// `nextCursor` a previous response gave it.
export class CursorPaginationQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
