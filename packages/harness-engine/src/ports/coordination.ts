import type { AdapterCorrelationEnvelope } from '../adapters/contracts.ts';
import { validateAdapterCorrelation } from '../adapters/contracts.ts';
import { isRfc3339Timestamp, isUnknown, validateEvidenceRef, validateKnown, type EvidenceRef, type Known, type Unknown } from '../core/result.ts';
export interface AdapterMetadata {
  readonly source: string;
  readonly version: string;
  readonly observedAt: string;
  readonly correlation?: AdapterCorrelationEnvelope;
}

export type PortResult<T> = Known<T> | Unknown;

export interface CoordinationRunDto extends AdapterMetadata {
  readonly runId: string;
  readonly status?: string;
}

export interface CoordinationTaskDto extends AdapterMetadata {
  readonly taskId: string;
  readonly runId?: string;
  readonly planId?: string;
  readonly status?: string;
}

export interface CoordinationDispatchDto extends AdapterMetadata {
  readonly dispatchId: string;
  readonly runId?: string;
  readonly taskId?: string;
  readonly status?: string;
}

export interface CoordinationWorkerDto extends AdapterMetadata {
  readonly workerId: string;
  readonly runId?: string;
  readonly taskId?: string;
  readonly status?: string;
}

export interface CoordinationDeliveryDto extends AdapterMetadata {
  readonly deliveryId: string;
  readonly dispatchId: string;
  readonly runId?: string;
  readonly taskId?: string;
  readonly status?: string;
}

/** 协调端口只读取稳定身份和状态，不携带动态任务正文或执行载荷。 */
export interface CoordinationAdapter {
  getRun(runId: string): Promise<PortResult<CoordinationRunDto>>;
  getTask(taskId: string): Promise<PortResult<CoordinationTaskDto>>;
  getDispatch(dispatchId: string): Promise<PortResult<CoordinationDispatchDto>>;
  getWorker(workerId: string): Promise<PortResult<CoordinationWorkerDto>>;
  getDelivery(deliveryId: string): Promise<PortResult<CoordinationDeliveryDto>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function validateDto(value: unknown, required: readonly string[], allowed: readonly string[]): boolean {
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => !allowed.includes(key))) return false;
  if (required.some((key) => !Object.hasOwn(value, key))) return false;
  if (!nonEmpty(value.source) || !nonEmpty(value.version) || !isRfc3339Timestamp(value.observedAt)) return false;
  if (value.correlation !== undefined && !validateAdapterCorrelation(value.correlation)) return false;
  return Object.entries(value).every(([key, item]) => key === 'correlation' || nonEmpty(item));
}

export function validateCoordinationRun(value: unknown): value is CoordinationRunDto {
  return validateDto(value, ['runId', 'source', 'version', 'observedAt'], [
    'runId', 'status', 'source', 'version', 'observedAt', 'correlation',
  ]);
}

export function validateCoordinationTask(value: unknown): value is CoordinationTaskDto {
  return validateDto(value, ['taskId', 'source', 'version', 'observedAt'], [
    'taskId', 'runId', 'planId', 'status', 'source', 'version', 'observedAt', 'correlation',
  ]);
}

export function validateCoordinationDispatch(value: unknown): value is CoordinationDispatchDto {
  return validateDto(value, ['dispatchId', 'source', 'version', 'observedAt'], [
    'dispatchId', 'runId', 'taskId', 'status', 'source', 'version', 'observedAt', 'correlation',
  ]);
}

export function validateCoordinationWorker(value: unknown): value is CoordinationWorkerDto {
  return validateDto(value, ['workerId', 'source', 'version', 'observedAt'], [
    'workerId', 'runId', 'taskId', 'status', 'source', 'version', 'observedAt', 'correlation',
  ]);
}
export function validateCoordinationDelivery(value: unknown): value is CoordinationDeliveryDto {
  return validateDto(value, ['deliveryId', 'dispatchId', 'source', 'version', 'observedAt'], [
    'deliveryId', 'dispatchId', 'runId', 'taskId', 'status', 'source', 'version', 'observedAt', 'correlation',
  ]);
}

export type RunDto = CoordinationRunDto;
export type TaskDto = CoordinationTaskDto;
export type DispatchDto = CoordinationDispatchDto;
export type WorkerDto = CoordinationWorkerDto;
export type DeliveryDto = CoordinationDeliveryDto;

export function validatePortResult<T>(
  value: unknown,
  validateValue?: (payload: unknown) => boolean,
): PortResult<T> {
  if (!isRecord(value)) throw new TypeError('PortResult must be an object');
  if (value.kind === 'known') {
    if (validateValue === undefined || !validateValue(value.value)) {
      throw new TypeError('A known PortResult requires a concrete validated payload');
    }
    validateKnown<T>(value);
    validateEvidenceRef(value.evidence);
    return value as unknown as PortResult<T>;
  }
  if (Object.keys(value).some((key) => !['kind', 'reasonCode', 'observedAt', 'recovery'].includes(key))
    || value.kind !== 'unknown' || !isUnknown(value)) {
    throw new TypeError('An unknown PortResult requires reasonCode, RFC 3339 observedAt, and no dynamic fields');
  }
  if (value.recovery !== undefined && !nonEmpty(value.recovery)) {
    throw new TypeError('PortResult recovery must be non-empty when present');
  }
  return value as unknown as PortResult<T>;
}
