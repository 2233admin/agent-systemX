import type { EvidenceRef, Unknown } from '../core/result.ts';
import { isRfc3339Timestamp } from '../core/result.ts';

export interface AdapterCorrelationEnvelope {
  readonly workflowId: string;
  readonly planId: string;
  readonly operationId: string;
  readonly snapshotId: string;
  readonly attemptId: string;
  readonly source: string;
  readonly sourceVersion: string;
  readonly observedAt: string;
}

export interface AdapterRequestCorrelation extends AdapterCorrelationEnvelope {
  readonly requestId: string;
}

export interface AdapterEventCorrelation extends AdapterCorrelationEnvelope {
  readonly eventId: string;
  readonly sequence: number;
}

export type AdapterError =
  | { readonly kind: 'unavailable'; readonly code: string; readonly message: string; readonly retryable: boolean; readonly authorizationScope?: string }
  | { readonly kind: 'timeout'; readonly code: string; readonly timeoutMs: number; readonly retryable: true; readonly authorizationScope?: string }
  | { readonly kind: 'permission-denied'; readonly code: string; readonly retryable: false; readonly authorizationScope: string }
  | { readonly kind: 'identity-mismatch'; readonly code: string; readonly retryable: false; readonly authorizationScope?: string }
  | { readonly kind: 'shape-invalid'; readonly code: string; readonly retryable: false; readonly authorizationScope?: string }
  | { readonly kind: 'stale'; readonly code: string; readonly retryable: false; readonly authorizationScope?: string }
  | { readonly kind: 'transport'; readonly code: string; readonly message: string; readonly retryable: boolean; readonly authorizationScope?: string };

export interface ControlledTransport<TRequest, TResponse> {
  readonly source: string;
  readonly version: string;
  request(input: TRequest): Promise<TResponse>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateAdapterCorrelation(value: unknown): value is AdapterCorrelationEnvelope {
  if (!record(value)) return false;
  const fields = ['workflowId', 'planId', 'operationId', 'snapshotId', 'attemptId', 'source', 'sourceVersion', 'observedAt'];
  return fields.every((field) => nonEmpty(value[field])) && isRfc3339Timestamp(value.observedAt);
}

export function validateAdapterRequestCorrelation(value: unknown): value is AdapterRequestCorrelation {
  return validateAdapterCorrelation(value) && record(value) && nonEmpty(value.requestId);
}

export function validateAdapterEventCorrelation(value: unknown): value is AdapterEventCorrelation {
  return validateAdapterCorrelation(value) && record(value) && nonEmpty(value.eventId)
    && typeof value.sequence === 'number' && Number.isSafeInteger(value.sequence) && value.sequence >= 0;
}

export function validateAdapterError(value: unknown): value is AdapterError {
  if (!record(value) || !nonEmpty(value.kind) || !nonEmpty(value.code) || typeof value.retryable !== 'boolean') return false;
  if (value.kind === 'timeout') return value.retryable === true && typeof value.timeoutMs === 'number' && value.timeoutMs > 0;
  if (value.kind === 'permission-denied') return value.retryable === false && nonEmpty(value.authorizationScope);
  return ['unavailable', 'identity-mismatch', 'shape-invalid', 'stale', 'transport'].includes(value.kind)
    && (value.kind === 'unavailable' || value.kind === 'transport' ? nonEmpty(value.message) : true);
}

export function unknownAdapterResult(error: AdapterError, observedAt: string, recovery: string): Unknown {
  if (!validateAdapterError(error) || !isRfc3339Timestamp(observedAt) || !nonEmpty(recovery)) {
    throw new TypeError('Adapter error and recovery must be valid');
  }
  return { kind: 'unknown', reasonCode: error.code, observedAt, recovery };
}

export function reconcileCorrelation(expected: AdapterCorrelationEnvelope, observed: unknown): AdapterError | null {
  if (!validateAdapterCorrelation(expected) || !record(observed)) return { kind: 'shape-invalid', code: 'adapter.correlation.shape-invalid', retryable: false };
  for (const key of ['workflowId', 'planId', 'operationId', 'snapshotId'] as const) {
    if (observed[key] !== undefined && observed[key] !== expected[key]) {
      return { kind: 'identity-mismatch', code: `adapter.correlation.${key}.mismatch`, retryable: false };
    }
  }
  return null;
}

export function reconcileEventSequence(previous: AdapterEventCorrelation | undefined, current: unknown): AdapterError | null {
  if (!validateAdapterEventCorrelation(current)) return { kind: 'shape-invalid', code: 'adapter.event.shape-invalid', retryable: false };
  if (previous !== undefined && !validateAdapterEventCorrelation(previous)) {
    return { kind: 'shape-invalid', code: 'adapter.event.previous-shape-invalid', retryable: false };
  }
  if (previous !== undefined && current.eventId === previous.eventId) {
    return { kind: 'stale', code: 'adapter.event.duplicate', retryable: false };
  }
  if (previous !== undefined && current.sequence <= previous.sequence) {
    return { kind: 'stale', code: 'adapter.event.out-of-order', retryable: false };
  }
  return null;
}

export function evidenceForCorrelation(correlation: AdapterCorrelationEnvelope, locator: string): EvidenceRef {
  return { source: correlation.source, observedAt: correlation.observedAt, locator };
}
