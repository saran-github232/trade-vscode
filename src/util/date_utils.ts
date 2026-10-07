/**
 * Deterministic date and period utilities.
 *
 * Used to build exact evaluation period labels used in every
 * ValidationRecord and every safe report. Reproducible and deterministic.
 */

/**
 * Build a canonical evaluation period label from a start and end date.
 *
 * Produces "YYYY-MM-DD..YYYY-MM-DD" format (inclusive on both ends).
 */
export function formatPeriodRange(start: Date, end: Date): string {
  return `${formatDate(start)}..${formatDate(end)}`;
}

/**
 * Format a Date as "YYYY-MM-DD" (local, deterministic).
 */
export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Parse a "YYYY-MM-DD..YYYY-MM-DD" period label into start and end dates.
 */
export function parsePeriodLabel(label: string): { start: Date; end: Date } {
  const [startStr, endStr] = label.split("..");
  if (!startStr || !endStr) {
    throw new Error(`Invalid period label: ${label}`);
  }
  return {
    start: parseDate(startStr),
    end: parseDate(endStr),
  };
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) {
    throw new Error(`Invalid date string: ${s}`);
  }
  return new Date(y, m - 1, d);
}
