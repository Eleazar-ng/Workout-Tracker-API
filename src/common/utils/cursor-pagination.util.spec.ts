import { BadRequestException } from '@nestjs/common';
import {
  buildKeysetWhere,
  decodeCursor,
  encodeCursor,
  paginateKeysetResults,
} from './cursor-pagination.util';

describe('cursor-pagination.util', () => {
  describe('encodeCursor / decodeCursor', () => {
    it('round-trips a string value and id', () => {
      const encoded = encodeCursor('Bench Press', 'exercise-123');
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual({ value: 'Bench Press', id: 'exercise-123' });
    });

    it('round-trips a Date value by normalizing to ISO string', () => {
      const date = new Date('2026-01-15T10:30:00.000Z');
      const encoded = encodeCursor(date, 'workout-456');
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual({
        value: '2026-01-15T10:30:00.000Z',
        id: 'workout-456',
      });
    });

    it('produces an opaque, URL-safe string', () => {
      const encoded = encodeCursor('some value', 'some-id');

      // base64url must not contain characters that need URL-encoding
      expect(encoded).not.toMatch(/[+/=]/);
    });

    it('throws BadRequestException for a non-base64 garbage string', () => {
      expect(() => decodeCursor('not-valid-base64-!!!')).toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException for valid base64 that is not JSON', () => {
      const garbage = Buffer.from('plain text, not json').toString(
        'base64url',
      );

      expect(() => decodeCursor(garbage)).toThrow(BadRequestException);
    });

    it('throws BadRequestException when the JSON is missing required fields', () => {
      const missingId = Buffer.from(JSON.stringify({ value: 'x' })).toString(
        'base64url',
      );

      expect(() => decodeCursor(missingId)).toThrow(BadRequestException);
    });

    it('throws BadRequestException when fields have the wrong type', () => {
      const wrongType = Buffer.from(
        JSON.stringify({ value: 123, id: 'ok' }),
      ).toString('base64url');

      expect(() => decodeCursor(wrongType)).toThrow(BadRequestException);
    });

    it('throws BadRequestException for a JSON array instead of an object', () => {
      const arrayPayload = Buffer.from(JSON.stringify(['a', 'b'])).toString(
        'base64url',
      );

      expect(() => decodeCursor(arrayPayload)).toThrow(BadRequestException);
    });
  });

  describe('buildKeysetWhere', () => {
    it('builds an ascending (gt) predicate', () => {
      const cursor = { value: '2026-01-01T00:00:00.000Z', id: 'abc' };

      const where = buildKeysetWhere(
        'scheduledAt',
        'asc',
        cursor,
        (v) => new Date(v),
      );

      expect(where).toEqual({
        OR: [
          { scheduledAt: { gt: new Date('2026-01-01T00:00:00.000Z') } },
          {
            scheduledAt: new Date('2026-01-01T00:00:00.000Z'),
            id: { gt: 'abc' },
          },
        ],
      });
    });

    it('builds a descending (lt) predicate', () => {
      const cursor = { value: '2026-01-01T00:00:00.000Z', id: 'abc' };

      const where = buildKeysetWhere(
        'updatedAt',
        'desc',
        cursor,
        (v) => new Date(v),
      );

      expect(where).toEqual({
        OR: [
          { updatedAt: { lt: new Date('2026-01-01T00:00:00.000Z') } },
          {
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            id: { lt: 'abc' },
          },
        ],
      });
    });

    it('passes the raw string through unchanged when no conversion is needed', () => {
      const cursor = { value: 'Bench Press', id: 'ex-1' };

      const where = buildKeysetWhere('name', 'asc', cursor, (v) => v);

      expect(where).toEqual({
        OR: [
          { name: { gt: 'Bench Press' } },
          { name: 'Bench Press', id: { gt: 'ex-1' } },
        ],
      });
    });
  });

  describe('paginateKeysetResults', () => {
    interface Row {
      id: string;
      sortValue: string;
    }

    const makeRows = (n: number): Row[] =>
      Array.from({ length: n }, (_, i) => ({
        id: `id-${i}`,
        sortValue: `value-${i}`,
      }));

    it('returns hasMore=false and nextCursor=null when fewer than limit+1 rows exist', () => {
      const rows = makeRows(3);

      const result = paginateKeysetResults(
        rows,
        5,
        (r) => r.sortValue,
        (r) => r.id,
      );

      expect(result.page).toHaveLength(3);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('returns hasMore=false and nextCursor=null when exactly limit rows exist', () => {
      const rows = makeRows(5);

      const result = paginateKeysetResults(
        rows,
        5,
        (r) => r.sortValue,
        (r) => r.id,
      );

      expect(result.page).toHaveLength(5);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('returns hasMore=true and trims to exactly `limit` when limit+1 rows exist', () => {
      const rows = makeRows(6); // limit + 1

      const result = paginateKeysetResults(
        rows,
        5,
        (r) => r.sortValue,
        (r) => r.id,
      );

      expect(result.page).toHaveLength(5);
      expect(result.hasMore).toBe(true);
      // The extra 6th row must NOT leak into the returned page.
      expect(result.page.map((r) => r.id)).not.toContain('id-5');
    });

    it('encodes nextCursor from the LAST item of the trimmed page, not the discarded extra row', () => {
      const rows = makeRows(6);

      const result = paginateKeysetResults(
        rows,
        5,
        (r) => r.sortValue,
        (r) => r.id,
      );

      const decoded = decodeCursor(result.nextCursor!);
      // page[4] (5th item, 0-indexed) is the last item actually returned —
      // the cursor must point here, not at the discarded 6th row.
      expect(decoded).toEqual({ value: 'value-4', id: 'id-4' });
    });

    it('handles an empty result set', () => {
      const result = paginateKeysetResults(
        [],
        5,
        (r: Row) => r.sortValue,
        (r: Row) => r.id,
      );

      expect(result.page).toEqual([]);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });
  });
});
