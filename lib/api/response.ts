import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { apiRequestContext } from './context';

export type ApiErrorCode =
  | 'invalid_request' | 'unauthorized' | 'forbidden' | 'not_found'
  | 'slot_full' | 'signup_closed' | 'already_signed_up' | 'marked_absent'
  | 'rank_required' | 'training_required' | 'idempotency_conflict'
  | 'conflict' | 'validation_failed' | 'internal_error';

export type ApiSuccess<T> = { data: T; meta: Record<string, unknown> };
export type ApiFailure = {
  error: { code: ApiErrorCode; message: string; details: Record<string, unknown>; correlationId: string };
};

export function apiSuccess<T>(data: T, options: { status?: number; meta?: Record<string, unknown> } = {}) {
  return NextResponse.json<ApiSuccess<T>>(
    { data, meta: options.meta ?? {} }, { status: options.status ?? 200 },
  );
}

export function apiError(status: number, code: ApiErrorCode, message: string, details: Record<string, unknown> = {}) {
  return NextResponse.json<ApiFailure>(
    { error: { code, message, details, correlationId: apiRequestContext.getStore()?.correlationId ?? randomUUID() } }, { status },
  );
}
