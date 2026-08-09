import { isSideOpTemplateCategory } from '@/lib/side-op';

export type TemplateFrequency = {
  _id?: string;
  frequency: string;
  type: 'SR' | 'LR';
  isAdditional: boolean;
  channel?: string;
  callsign?: string;
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;

const toNonNegativeInteger = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;

const toPositiveInteger = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : fallback;

export function normalizeTemplateSlots(value: unknown): UnknownRecord[] {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.map((rawSquad, squadIndex) => {
    const squad = asRecord(rawSquad) ?? {};
    const rawSlots = Array.isArray(squad.slots)
      ? squad.slots
      : Array.isArray(squad.subslots) ? squad.subslots : [];
    const { subslots: _legacySubslots, ...canonicalSquad } = squad;
    void _legacySubslots;
    return {
      ...canonicalSquad,
      name: typeof squad.name === 'string' ? squad.name : `Squad ${squadIndex + 1}`,
      orderIndex: toNonNegativeInteger(squad.orderIndex, squadIndex),
      slots: rawSlots.map((rawSlot, slotIndex) => {
        const slot = asRecord(rawSlot) ?? {};
        return {
          ...slot,
          name: typeof slot.name === 'string' ? slot.name : 'Unknown Role',
          orderIndex: toNonNegativeInteger(slot.orderIndex, slotIndex),
          maxSignups: toPositiveInteger(slot.maxSignups, 1),
        };
      }),
    };
  });
}

export function normalizeTemplateForRead<T extends UnknownRecord>(template: T) {
  return {
    ...template,
    slotsJson: normalizeTemplateSlots(template.slotsJson),
    frequencyIds: Array.isArray(template.frequencyIds) ? template.frequencyIds : [],
    tempFrequencies: Array.isArray(template.tempFrequencies) ? template.tempFrequencies : [],
    isSideOp: typeof template.isSideOp === 'boolean'
      ? template.isSideOp
      : isSideOpTemplateCategory(typeof template.category === 'string' ? template.category : null),
    timezone: typeof template.timezone === 'string' ? template.timezone : null,
  };
}
