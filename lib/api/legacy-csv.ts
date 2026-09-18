import { rejectAttendance as fail } from './attendance';
/** CSV cells with quoted commas, escaped quotes and CRLF; no silent row truncation. */
export function parseLegacyCsv(input: unknown): string[][] {
  if (typeof input !== 'string' || !input.trim() || input.length > 1_000_000) fail(422, 'csvData must contain 1–1,000,000 characters.');
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false, closed = false;
  const finish = () => { row.push(cell.trim()); cell = ''; closed = false; };
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) { if (char === '"') { if (input[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } } else cell += char; continue; }
    if (char === '"') { if (cell.trim() || closed) fail(422, 'Malformed CSV quoting.'); cell = ''; quoted = true; }
    else if (char === ',') finish();
    else if (char === '\n' || char === '\r') { if (char === '\r' && input[i + 1] === '\n') i++; finish(); if (row.some(Boolean)) rows.push(row); row = []; }
    else if (!closed || /\s/.test(char)) cell += char;
    else fail(422, 'Unexpected text after a quoted CSV cell.');
  }
  if (quoted) fail(422, 'Unterminated quoted CSV cell.');
  finish(); if (row.some(Boolean)) rows.push(row);
  return rows;
}
