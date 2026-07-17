// Date normalization shared by ingest and the dashboard's server-side aggregation.
//
// Sources persist `posted_at` in assorted string formats. Most (LinkedIn, Adzuna,
// CV-Library, Hays, Jooble, Advance TRS) emit ISO 8601, which `Date.parse` handles.
// Reed emits UK-style DD/MM/YYYY, which `Date.parse` either rejects (day > 12) or
// silently misreads as US MM/DD. Normalizing at ingest keeps `posted_at` in one
// well-defined shape (ISO date) so every downstream consumer parses it consistently.

const UK_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

// Parse a DD/MM/YYYY string to a UTC-midnight timestamp, or null if invalid.
// UTC (not local) so the calendar date survives the round-trip to an ISO string.
function parseUkDate(s) {
  const m = s.match(UK_DATE_RE);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  const year = parseInt(m[3], 10);
  const ts = Date.UTC(year, month, day);
  const d = new Date(ts);
  // Reject impossible dates (e.g. 31/02) that Date rolls over into the next month.
  if (d.getUTCFullYear() === year && d.getUTCMonth() === month && d.getUTCDate() === day) {
    return ts;
  }
  return null;
}

/**
 * Parse a stored posted_at string to a millisecond timestamp, or null if unknown.
 * Understands ISO 8601 plus UK-style DD/MM/YYYY; never misreads the latter as US order.
 */
export function parseFlexibleDate(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  const uk = parseUkDate(s);
  if (uk != null) return uk;
  if (UK_DATE_RE.test(s)) return null; // matched shape but invalid calendar date
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/**
 * Normalize a raw source date to an ISO 8601 string for storage in posted_at.
 * Returns the trimmed original string when it can't be parsed (so we never
 * discard a value we simply don't recognize); null/'' pass through unchanged.
 */
export function normalizePostedAt(raw) {
  if (raw == null || raw === '') return raw ?? null;
  const s = String(raw).trim();
  if (UK_DATE_RE.test(s)) {
    const uk = parseUkDate(s);
    return uk != null ? new Date(uk).toISOString() : s;
  }
  // Already ISO or another Date-parseable form — keep it as-is so we don't
  // rewrite timestamps that already carry a time-of-day component.
  return s;
}
