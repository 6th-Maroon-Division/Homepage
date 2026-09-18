import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePositiveId, parseCursorPagination } from '../lib/api/validation';
import { apiSuccess, apiError } from '../lib/api/response';

test('IDs reject coercion, partial numbers and unsafe integers', () => {
  for (const value of [true, false, [], [1], {}, null, undefined, '', ' ', '1foo', '1.5', '1e2', '0x10', '+1', '-1', ' 1', Infinity, NaN, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(parsePositiveId(value), null, String(value));
  }
  assert.equal(parsePositiveId(42), 42);
  assert.equal(parsePositiveId('42'), 42);
});

test('pagination retains defaults, caps large pages and validates supplied cursors', () => {
  const options = { defaultLimit: 50, maxLimit: 100 };
  assert.deepEqual(parseCursorPagination(new URLSearchParams(), options), { data: { limit: 50, cursor: null } });
  assert.deepEqual(parseCursorPagination(new URLSearchParams('limit=200&cursor=42'), options), { data: { limit: 100, cursor: 42 } });
  for (const query of ['limit=', 'limit=0', 'limit=2.5', 'limit=no', 'cursor=', 'cursor=0', 'cursor=true', 'cursor=1.5']) {
    assert.ok(parseCursorPagination(new URLSearchParams(query), options).error, query);
  }
});

test('success contracts keep entity and pagination metadata separate', async () => {
  const response = apiSuccess([{ id: 1 }], { status: 201, meta: { nextCursor: '1' } });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { data: [{ id: 1 }], meta: { nextCursor: '1' } });
  assert.deepEqual(await apiSuccess(null).json(), { data: null, meta: {} });
});

test('errors expose stable codes, details and unique correlation IDs', async () => {
  const response = apiError(422, 'validation_failed', 'Invalid name.', { field: 'name' });
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.deepEqual({ ...body.error, correlationId: undefined }, {
    code: 'validation_failed', message: 'Invalid name.', details: { field: 'name' }, correlationId: undefined,
  });
  assert.match(body.error.correlationId, /^[0-9a-f-]{36}$/);
  assert.notEqual(body.error.correlationId, (await apiError(422, 'validation_failed', 'Invalid name.').json()).error.correlationId);
});
