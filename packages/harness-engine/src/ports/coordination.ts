import { isRfc3339Timestamp } from '../core/result.ts';

export interface AdapterMetadata {
  readonly source: string;
  readonly version: string;
  readonly observedAt: string;
}

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
  readonly runId?: string;
  readonly taskId?: string;
  readonly status?: string;
}

/** 协调端口只读取稳定身份和状态，不携带动态任务正文或执行载荷。 */
export interface CoordinationAdapter {
  getRun(runId: string): Promise<CoordinationRunDto | null>;
  getTask(taskId: string): Promise<CoordinationTaskDto | null>;
  getDispatch(dispatchId: string): Promise<CoordinationDispatchDto | null>;
  getWorker(workerId: string): Promise<CoordinationWorkerDto | null>;
  getDelivery(deliveryId: string): Promise<CoordinationDeliveryDto | null>;
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
  return Object.keys(value).every((key) => nonEmpty(value[key]));
}

export function validateCoordinationRun(value: unknown): value is CoordinationRunDto {
  return validateDto(value, ['runId', 'source', 'version', 'observedAt'], [
    'runId', 'status', 'source', 'version', 'observedAt',
  ]);
}

export function validateCoordinationTask(value: unknown): value is CoordinationTaskDto {
  return validateDto(value, ['taskId', 'source', 'version', 'observedAt'], [
    'taskId', 'runId', 'planId', 'status', 'source', 'version', 'observedAt',
  ]);
}

export function validateCoordinationDispatch(value: unknown): value is CoordinationDispatchDto {
  return validateDto(value, ['dispatchId', 'source', 'version', 'observedAt'], [
    'dispatchId', 'runId', 'taskId', 'status', 'source', 'version', 'observedAt',
  ]);
}

export function validateCoordinationWorker(value: unknown): value is CoordinationWorkerDto {
  return validateDto(value, ['workerId', 'source', 'version', 'observedAt'], [
    'workerId', 'runId', 'taskId', 'status', 'source', 'version', 'observedAt',
  ]);
}

export function validateCoordinationDelivery(value: unknown): value is CoordinationDeliveryDto {
  return validateDto(value, ['deliveryId', 'source', 'version', 'observedAt'], [
    'deliveryId', 'runId', 'taskId', 'status', 'source', 'version', 'observedAt',
  ]);
}

export type RunDto = CoordinationRunDto;
export type TaskDto = CoordinationTaskDto;
export type DispatchDto = CoordinationDispatchDto;
export type WorkerDto = CoordinationWorkerDto;
export type DeliveryDto = CoordinationDeliveryDto;
