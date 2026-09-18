import assert from 'node:assert/strict';
import { utcOperationDate, utcOperationDateInput } from '../lib/orbat-form-dates';

const originalTimezone = process.env.TZ;
try {
  for (const timezone of ['UTC', 'America/New_York', 'Europe/Berlin', 'Pacific/Auckland']) {
    process.env.TZ = timezone;
    for (const day of ['2099-10-01', '2028-02-29', '2026-03-29', '2026-10-25']) {
      const created = utcOperationDate(day)!;
      const reopened = utcOperationDateInput(created.toISOString());
      assert.equal(reopened, day, timezone);
      assert.equal(utcOperationDate(reopened)?.toISOString(), `${day}T00:00:00.000Z`, timezone);
    }
  }
  for (const invalid of ['', '2026-02-30', '2026-2-1', 'not a date']) assert.equal(utcOperationDate(invalid), null);
  assert.equal(utcOperationDateInput('invalid'), '');
} finally {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
}
