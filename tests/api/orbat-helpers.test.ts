import { expect, test } from 'vitest';
import { normalizeTemplateSlots, normalizeTemplateForRead, normalizeTemplateFrequencyIds, copyOrbatPresetSlots } from '@/lib/orbat-template';
import { resolveOrbatScheduleWindow } from '@/lib/orbat-schedule';
import { utcOperationDate, utcOperationDateInput } from '@/lib/orbat-form-dates';

test('legacy presets normalize broken structures and numeric limits without losing usable roles', () => {
  for (const input of [null, {}, 2, '{bad json', 'null']) expect(normalizeTemplateSlots(input)).toEqual([]);
  expect(normalizeTemplateSlots([null, {}, { name: 'Alpha', orderIndex: -1, subslots: [null, { name: 'Medic', orderIndex: Infinity, maxSignups: NaN }, { squadRole: { name: 'Current' }, name: 'Old', orderIndex: 2.7, maxSignups: 3.8 }] }])).toEqual([
    { name: 'Squad 1', orderIndex: 0, slots: [] }, { name: 'Squad 2', orderIndex: 1, slots: [] },
    { name: 'Alpha', orderIndex: 2, slots: [{ name: 'Unknown Role', orderIndex: 0, maxSignups: 1 }, { name: 'Medic', orderIndex: 1, maxSignups: 1 }, { squadRole: { name: 'Current' }, name: 'Current', orderIndex: 2, maxSignups: 3 }] },
  ]);
  expect(normalizeTemplateSlots([{ orderIndex: NaN, slots: [{ maxSignups: 0, orderIndex: '0' }, { maxSignups: Infinity }, { maxSignups: '2' }] }])[0]).toMatchObject({ orderIndex: 0, slots: [{ maxSignups: 1 }, { maxSignups: 1 }, { maxSignups: 1 }] });
});
test('preset copies strip persisted identities and signups across supported legacy containers', () => {
  const squads = [{ id: 1, name: 'Alpha', slots: [{ id: 2, squadRoleId: 3, squadRole: { name: 'Medic' }, signups: [{ userId: 4 }], maxSignups: 2 }, {}] }];
  const expected = [{ name: 'Alpha', orderIndex: 0, subslots: [{ name: 'Medic', squadRoleId: 3, orderIndex: 0, maxSignups: 2 }, { name: 'Unknown Role', squadRoleId: null, orderIndex: 1, maxSignups: 1 }] }];
  for (const source of [{ slotsJson: JSON.stringify(squads) }, { squads }, { slots: squads }]) expect(copyOrbatPresetSlots(source)).toEqual(expected);
  expect(copyOrbatPresetSlots({})).toEqual([]);
  expect(normalizeTemplateFrequencyIds([3, 2, 3])).toEqual([3, 2]);
  for (const input of [null, '3', [1.5], [0], ['3']]) expect(normalizeTemplateFrequencyIds(input)).toBeNull();
  expect(normalizeTemplateForRead({ category: 'Side Op' })).toMatchObject({ isSideOp: true, timezone: null, frequencyIds: [], tempFrequencies: [], slotsJson: [] });
  expect(normalizeTemplateForRead({ category: null, isSideOp: false, timezone: 'Europe/Berlin', frequencyIds: [1], tempFrequencies: [{ frequency: '50' }], slotsJson: [] })).toMatchObject({ isSideOp: false, timezone: 'Europe/Berlin', frequencyIds: [1], tempFrequencies: [{ frequency: '50' }] });
  expect(normalizeTemplateForRead({})).toMatchObject({ isSideOp: false });
});
test('UTC date inputs reject invalid calendars and never shift into the local timezone', () => {
  expect(utcOperationDateInput('2099-07-20T23:00:00-04:00')).toBe('2099-07-21');
  expect(utcOperationDateInput('invalid')).toBe('');
  expect(utcOperationDate('2099-02-29')).toBeNull();
  expect(utcOperationDate('2099-07-20')?.toISOString()).toBe('2099-07-20T00:00:00.000Z');
});
test('legacy UTC schedule clocks roll overnight ends and use sensible untimed cutoffs', () => {
  const eventDate = new Date('2099-07-20T00:00:00Z');
  expect(resolveOrbatScheduleWindow({})).toEqual({ startsAtUtc: null, endsAtUtc: null, cutoff: null });
  expect(resolveOrbatScheduleWindow({ eventDate })).toEqual({ startsAtUtc: null, endsAtUtc: null, cutoff: new Date('2099-07-20T23:59:59.999Z') });
  expect(resolveOrbatScheduleWindow({ eventDate, startTime: '23:00', endTime: '01:00' })).toEqual({ startsAtUtc: new Date('2099-07-20T23:00:00Z'), endsAtUtc: new Date('2099-07-21T01:00:00Z'), cutoff: new Date('2099-07-21T01:00:00Z') });
  expect(resolveOrbatScheduleWindow({ eventDate, startTime: 'invalid', endTime: 'invalid' }).cutoff).toEqual(new Date('2099-07-20T23:59:59.999Z'));
  expect(resolveOrbatScheduleWindow({ eventDate, endTime: '20:00' })).toMatchObject({ startsAtUtc: null, endsAtUtc: new Date('2099-07-20T20:00:00Z') });
  expect(resolveOrbatScheduleWindow({ startsAtUtc: eventDate, endsAtUtc: new Date('2099-07-20T20:00:00Z') }).cutoff).toEqual(new Date('2099-07-20T20:00:00Z'));
  expect(resolveOrbatScheduleWindow({ startsAtUtc: eventDate }).cutoff).toEqual(eventDate);
});
