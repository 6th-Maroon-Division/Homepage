import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTemplateForRead, normalizeTemplateFrequencyIds, normalizeTemplateSlots } from '../lib/orbat-template';

test('legacy templates are normalized without losing their structure', () => {
  const result = normalizeTemplateForRead({
    category: 'Side Op',
    slotsJson: JSON.stringify([{ name: 'Alpha', subslots: [{ name: 'Medic' }] }]),
  });

  assert.equal(result.isSideOp, true);
  assert.deepEqual(result.frequencyIds, []);
  assert.deepEqual(result.tempFrequencies, []);
  assert.deepEqual(result.slotsJson, [{
    name: 'Alpha',
    orderIndex: 0,
    slots: [{ name: 'Medic', orderIndex: 0, maxSignups: 1 }],
  }]);
});

test('explicit aligned values take precedence over legacy category values', () => {
  const result = normalizeTemplateForRead({
    category: 'Side Op',
    isSideOp: false,
    timezone: 'Europe/Berlin',
    frequencyIds: [2],
    tempFrequencies: [{ frequency: '50', type: 'LR', isAdditional: false }],
    slotsJson: [],
  });

  assert.equal(result.isSideOp, false);
  assert.equal(result.timezone, 'Europe/Berlin');
  assert.deepEqual(result.frequencyIds, [2]);
  assert.equal(result.tempFrequencies.length, 1);
});

test('malformed legacy slot JSON safely normalizes to an empty structure', () => {
  assert.deepEqual(normalizeTemplateSlots('{bad json'), []);
});

test('multiple instances of the same role are preserved within a squad', () => {
  const slots = normalizeTemplateSlots([{
    name: 'Alpha',
    slots: [
      { name: 'Rifleman', squadRoleId: 7, orderIndex: 0, maxSignups: 1 },
      { name: 'Rifleman', squadRoleId: 7, orderIndex: 1, maxSignups: 2 },
    ],
  }]);

  const squadSlots = slots[0].slots as Array<Record<string, unknown>>;
  assert.equal(squadSlots.length, 2);
  assert.equal(squadSlots[0].squadRoleId, 7);
  assert.equal(squadSlots[1].squadRoleId, 7);
  assert.equal(squadSlots[1].maxSignups, 2);
});

test('invalid numeric slot values are replaced with safe canonical defaults', () => {
  const slots = normalizeTemplateSlots([{
    name: 'Alpha',
    orderIndex: Number.NaN,
    slots: [
      { name: 'Medic', orderIndex: Number.POSITIVE_INFINITY, maxSignups: Number.NaN },
      { name: 'Rifleman', orderIndex: -2, maxSignups: 2.9 },
    ],
  }]);

  assert.equal(slots[0].orderIndex, 0);
  const squadSlots = slots[0].slots as Array<Record<string, unknown>>;
  assert.equal(squadSlots[0].orderIndex, 0);
  assert.equal(squadSlots[0].maxSignups, 1);
  assert.equal(squadSlots[1].orderIndex, 1);
  assert.equal(squadSlots[1].maxSignups, 2);
});

test('frequency IDs require positive integers and are deduplicated', () => {
  assert.deepEqual(normalizeTemplateFrequencyIds([3, 1, 3]), [3, 1]);
  assert.deepEqual(normalizeTemplateFrequencyIds([]), []);
  assert.equal(normalizeTemplateFrequencyIds(['3']), null);
  assert.equal(normalizeTemplateFrequencyIds([0]), null);
  assert.equal(normalizeTemplateFrequencyIds([1.5]), null);
  assert.equal(normalizeTemplateFrequencyIds('3'), null);
});
