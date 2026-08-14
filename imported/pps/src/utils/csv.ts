// Escapes a value for safe inclusion in a CSV field (RFC 4180).
//
// This is what prevents the column-breaking bug from the previous version, where
// a free-text response containing a comma (or quote/newline) shifted every later
// column. A field is wrapped in double quotes when it contains a comma, a double
// quote, or a newline; embedded double quotes are doubled; newlines are flattened
// to spaces so a single response stays on one CSV row.
//
// Every value written to a CSV row MUST pass through this — callers build rows
// with `[...].map(csvEscape).join(",")`. See csv.test.ts for the guarantees.
export function csvEscape(value: unknown): string {
  const s = value !== undefined && value !== null ? String(value) : "";
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    const noNewlines = s.replace(/\r?\n|\r/g, " ");
    const escapedQuotes = noNewlines.replace(/"/g, '""');
    return `"${escapedQuotes}"`;
  }
  return s;
}
