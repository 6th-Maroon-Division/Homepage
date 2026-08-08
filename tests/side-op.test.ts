import assert from 'node:assert/strict';
import test from 'node:test';

import { isSideOpTemplateCategory } from '../lib/side-op';

test('recognizes common side-op template category spellings', () => {
  assert.equal(isSideOpTemplateCategory('Side Op'), true);
  assert.equal(isSideOpTemplateCategory('side-op'), true);
  assert.equal(isSideOpTemplateCategory('SIDE_OP'), true);
});

test('does not treat other or empty categories as side ops', () => {
  assert.equal(isSideOpTemplateCategory('Combat'), false);
  assert.equal(isSideOpTemplateCategory(null), false);
});
