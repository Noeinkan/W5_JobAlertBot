import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlexibleDate, normalizePostedAt } from '../src/utils/dates.js';

describe('parseFlexibleDate', () => {
  it('parses ISO 8601 with time + zone', () => {
    assert.equal(parseFlexibleDate('2026-03-21T20:18:05Z'), Date.parse('2026-03-21T20:18:05Z'));
    assert.equal(parseFlexibleDate('2025-09-29T00:00:00.000Z'), Date.parse('2025-09-29T00:00:00.000Z'));
  });

  it('parses UK DD/MM/YYYY as day-first, not US month-first', () => {
    // 11/03 must be 11 March, not 3 November.
    assert.equal(parseFlexibleDate('11/03/2026'), Date.UTC(2026, 2, 11));
  });

  it('parses UK dates whose day > 12 (which Date.parse rejects as NaN)', () => {
    assert.equal(parseFlexibleDate('23/02/2026'), Date.UTC(2026, 1, 23));
    assert.equal(parseFlexibleDate('30/04/2026'), Date.UTC(2026, 3, 30));
  });

  it('returns null for empty, nullish, and impossible dates', () => {
    assert.equal(parseFlexibleDate(''), null);
    assert.equal(parseFlexibleDate(null), null);
    assert.equal(parseFlexibleDate(undefined), null);
    assert.equal(parseFlexibleDate('31/02/2026'), null); // no 31st of February
    assert.equal(parseFlexibleDate('not a date'), null);
  });
});

describe('normalizePostedAt', () => {
  it('rewrites UK DD/MM/YYYY to a UTC-midnight ISO string preserving the calendar date', () => {
    assert.equal(normalizePostedAt('11/03/2026'), '2026-03-11T00:00:00.000Z');
    assert.equal(normalizePostedAt('23/02/2026'), '2026-02-23T00:00:00.000Z');
  });

  it('leaves ISO values untouched (does not drop time-of-day)', () => {
    assert.equal(normalizePostedAt('2026-03-21T20:18:05Z'), '2026-03-21T20:18:05Z');
  });

  it('passes null/empty through and keeps unrecognized strings verbatim', () => {
    assert.equal(normalizePostedAt(null), null);
    assert.equal(normalizePostedAt(''), '');
    assert.equal(normalizePostedAt('sometime last week'), 'sometime last week');
  });

  it('round-trips: a normalized UK date parses back to the same calendar day', () => {
    const iso = normalizePostedAt('30/04/2026');
    assert.equal(parseFlexibleDate(iso), Date.UTC(2026, 3, 30));
  });
});
