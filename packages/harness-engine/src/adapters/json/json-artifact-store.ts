import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { canonicalHashFor, createCanonicalArtifact, validateCanonicalArtifact, type CanonicalArtifactEnvelope } from '../../artifacts/canonical.ts';
import { isRfc3339Timestamp } from '../../core/result';
import { validateArtifactRevision } from '../../core/ids';
import { isPlanStatus, type ExecutionLease, type IntegrationMergeLease, type PlanRow, type WorkflowSnapshot } from '../../domain/workflow';
import { validateLease as isCanonicalLease } from '../../domain/lease';
import type { ArtifactStore, WorkflowWriteRequest, WorkflowWriteResult } from '../../ports/artifacts';

const CURRENT_SCHEMA_VERSION = 1;
const PRIVATE_KEYS: Record<string, true> = {
  credential: true,
  credentials: true,
  dynamictask: true,
  dynamictaskfields: true,
  prompt: true,
  toolpayload: true,
  transcript: true,
};

type JsonRecord = Record<string, unknown>;

type WorkflowDto = {
  schemaVersion: number;
  revision: number;
  workflowId: string;
  plans: unknown[];
  integrationMergeLease?: unknown;
  updatedAt: string;
  canonicalHash?: string;
};

type WorkflowEnvelopeValue = {
  plans: unknown[];
  integrationMergeLease?: unknown;
  operations?: Record<string, unknown>;
};

type WorkflowEnvelopeDto = CanonicalArtifactEnvelope<WorkflowEnvelopeValue>;

type StoredWorkflow = {
  readonly snapshot: WorkflowSnapshot;
  readonly operations: Record<string, OperationRecord>;
};

type OperationRecord = {
  readonly operationId: string;
  readonly inputDigest: string;
  readonly snapshot: WorkflowSnapshot;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function privateKey(value: string): boolean {
  // 先做 Unicode 兼容与格式归一化，再识别动态正文字段，避免全角或不可见字符逃逸。
  const normalizedUnicode = value.normalize('NFKC').toLowerCase().replace(/[\p{Cf}\p{Z}\s]/gu, '');
  if (normalizedUnicode.includes('task正文') || normalizedUnicode.includes('prompt正文')
    || normalizedUnicode.includes('taskbody') || normalizedUnicode.includes('promptbody')) {
    return true;
  }
  const normalized = normalizedUnicode.replace(/[^a-zA-Z0-9]/g, '');
  return PRIVATE_KEYS[normalized] === true
    || normalized.startsWith('dynamictask')
    || normalized.startsWith('toolpayload');
}

function sanitizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJson(item));
  }
  if (!isRecord(value)) {
    return value;
  }

  const sanitized: JsonRecord = {};
  for (const [key, child] of Object.entries(value)) {
    if (!privateKey(key)) {
      sanitized[key] = sanitizeJson(child);
    }
  }
  return sanitized;
}


function workflowPath(rootDirectory: string, workflowId: string): string {
  if (workflowId.trim().length === 0 || workflowId === '.' || workflowId === '..' || /[\\/]/.test(workflowId)) {
    throw new TypeError('workflowId must be a non-empty path-safe identifier');
  }
  return join(rootDirectory, 'workflows', `${workflowId}.json`);
}

function validateRevision(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Workflow revision must be a non-negative safe integer');
  }
}

function assertLease(
  value: unknown,
  label: string,
  expectedKind: 'execution' | 'integration-merge',
): ExecutionLease | IntegrationMergeLease {
  if (!isCanonicalLease(value) || value.kind !== expectedKind) {
    throw new TypeError(`${label} must be a canonical ${expectedKind} lease`);
  }
  return value;
}

type LockPayload = {
  ownerPid: number;
  ownerToken: string;
  createdAt: string;
};

function ownerIsRunning(ownerPid: number): boolean {
  try {
    process.kill(ownerPid, 0);
    return true;
  } catch (error) {
    // 权限错误或未知错误不能证明进程已退出，因此保守地视为仍存活。
    return !(isNodeError(error) && error.code === 'ESRCH');
  }
}

async function recoverStaleLock(lockPath: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(lockPath, 'utf8');
  } catch (error) {
    return isNodeError(error) && error.code === 'ENOENT';
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    return false;
  }
  if (!isRecord(payload)
    || typeof payload.ownerPid !== 'number'
    || !Number.isSafeInteger(payload.ownerPid)
    || payload.ownerPid <= 0
    || typeof payload.ownerToken !== 'string'
    || payload.ownerToken.trim().length === 0
    || typeof payload.createdAt !== 'string'
    || !isRfc3339Timestamp(payload.createdAt)
    || ownerIsRunning(payload.ownerPid)) {
    return false;
  }
  const recoveryPath = `${lockPath}.recovery-${randomUUID()}`;
  try {
    await rename(lockPath, recoveryPath);
  } catch (error) {
    return isNodeError(error) && error.code === 'ENOENT';
  }

  let removeRecovery = false;
  try {
    const claimed = JSON.parse(await readFile(recoveryPath, 'utf8')) as unknown;
    if (!isRecord(claimed)
      || claimed.ownerToken !== payload.ownerToken
      || typeof claimed.ownerPid !== 'number'
      || ownerIsRunning(claimed.ownerPid)) {
      return false;
    }
    removeRecovery = true;
    return true;
  } finally {
    if (removeRecovery) {
      await rm(recoveryPath, { force: true });
    } else {
      // 失败时仅用 wx 恢复，若新锁已出现则保留双方文件，绝不覆盖新 owner。
      try {
        await writeFile(lockPath, raw, { encoding: 'utf8', flag: 'wx' });
        await rm(recoveryPath, { force: true });
      } catch {
        // 恢复失败时保留 recovery 文件，避免丢失未知 owner 的锁。
      }
    }
  }
}

async function createWriteLock(lockPath: string): Promise<void> {
  const payload: LockPayload = {
    ownerPid: process.pid,
    ownerToken: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  await writeFile(lockPath, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', flag: 'wx' });
}

async function acquireWriteLock(lockPath: string): Promise<void> {
  try {
    await createWriteLock(lockPath);
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'EEXIST') {
      throw error;
    }
    if (!await recoverStaleLock(lockPath)) {
      throw new Error('Workflow write lock conflict');
    }
    try {
      await createWriteLock(lockPath);
    } catch (retryError) {
      if (isNodeError(retryError) && retryError.code === 'EEXIST') {
        throw new Error('Workflow write lock conflict');
      }
      throw retryError;
    }
  }
}

function validatePlan(value: unknown): PlanRow {
  if (!isRecord(value)
    || Object.keys(value).some((key) => !['id', 'title', 'status', 'metadata', 'executionLease'].includes(key))
    || !Object.hasOwn(value, 'id') || !Object.hasOwn(value, 'title') || !Object.hasOwn(value, 'status')
    || !Object.hasOwn(value, 'metadata')
    || typeof value.id !== 'string' || value.id.trim().length === 0
    || typeof value.title !== 'string' || value.title.trim().length === 0
    || !isPlanStatus(value.status) || !isRecord(value.metadata)) {
    throw new TypeError('Workflow plan row is malformed');
  }
  const executionLease = value.executionLease === undefined
    ? undefined
    : assertLease(value.executionLease, 'Workflow execution lease', 'execution') as ExecutionLease;
  if (value.status === 'Done' && executionLease !== undefined) {
    throw new TypeError('A Done workflow plan cannot retain an execution lease');
  }
  return {
    id: value.id,
    title: value.title,
    status: value.status,
    metadata: sanitizeJson(value.metadata) as Readonly<Record<string, unknown>>,
    ...(executionLease === undefined ? {} : { executionLease }),
  };
}

function validateWorkflowDto(value: unknown): WorkflowDto {
  if (!isRecord(value)) {
    throw new TypeError('Workflow artifact must contain a JSON object');
  }
  if (value.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    if (typeof value.schemaVersion === 'number' && value.schemaVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error(`Unsupported future workflow schema version: ${value.schemaVersion}`);
    }
    throw new Error(`Unsupported workflow schema version: ${String(value.schemaVersion)}`);
  }
  validateRevision(value.revision);
  if (typeof value.workflowId !== 'string' || value.workflowId.trim().length === 0) {
    throw new TypeError('Workflow artifact requires a non-empty workflowId');
  }
  if (!Array.isArray(value.plans)) {
    throw new TypeError('Workflow artifact plans must be an array');
  }
  for (let index = 0; index < value.plans.length; index += 1) {
    if (!(index in value.plans)) throw new TypeError('Workflow artifact plans must be dense');
    validatePlan(value.plans[index]);
  }
  if (typeof value.updatedAt !== 'string') {
    throw new TypeError('Workflow artifact requires updatedAt');
  }
  validateArtifactRevision({
    schemaVersion: value.schemaVersion,
    revision: value.revision,
    updatedAt: value.updatedAt,
  });
  if (value.canonicalHash !== undefined) {
    if (typeof value.canonicalHash !== 'string' || !/^[a-f0-9]{64}$/i.test(value.canonicalHash)) {
      throw new TypeError('Workflow artifact canonical hash is malformed');
    }
    const { canonicalHash: _canonicalHash, ...withoutHash } = value;
    if (canonicalHashFor(withoutHash) !== value.canonicalHash.toLowerCase()) {
      throw new Error('Workflow artifact canonical hash does not match content');
    }
  }
  return value as unknown as WorkflowDto;
}

function validateWorkflowEnvelope(value: unknown): { dto: WorkflowDto; operations: Record<string, OperationRecord> } {
  const envelope = validateCanonicalArtifact(value);
  if (envelope.artifactKind !== 'workflow') throw new TypeError('Workflow artifact kind must be workflow');
  if (!isRecord(envelope.value) || !Array.isArray(envelope.value.plans)) {
    throw new TypeError('Workflow canonical envelope value must contain plans');
  }
  const dto = validateWorkflowDto({
    schemaVersion: 1,
    revision: envelope.revision,
    workflowId: envelope.workflowId,
    plans: envelope.value.plans,
    ...(envelope.value.integrationMergeLease === undefined ? {} : { integrationMergeLease: envelope.value.integrationMergeLease }),
    updatedAt: envelope.observedAt,
  });
  const operations: Record<string, OperationRecord> = {};
  if (envelope.value.operations !== undefined) {
    if (!isRecord(envelope.value.operations)) throw new TypeError('Workflow operation evidence must be an object');
    for (const [key, raw] of Object.entries(envelope.value.operations)) {
      if (!isRecord(raw) || typeof raw.operationId !== 'string' || typeof raw.inputDigest !== 'string' || !isRecord(raw.snapshot)) {
        throw new TypeError('Workflow operation evidence is malformed');
      }
      operations[key] = {
        operationId: raw.operationId,
        inputDigest: raw.inputDigest,
        snapshot: toSnapshot(validateWorkflowDto(raw.snapshot)),
      };
    }
  }
  return { dto, operations };
}

function toSnapshot(dto: WorkflowDto): WorkflowSnapshot {
  const integrationMergeLease = dto.integrationMergeLease === undefined
    ? undefined
    : assertLease(dto.integrationMergeLease, 'Workflow integration merge lease', 'integration-merge') as IntegrationMergeLease;
  return {
    schemaVersion: 1,
    revision: dto.revision,
    workflowId: dto.workflowId,
    plans: dto.plans.map((plan) => validatePlan(plan)),
    ...(integrationMergeLease === undefined ? {} : { integrationMergeLease }),
    updatedAt: dto.updatedAt,
  };
}

function toEnvelope(snapshot: WorkflowSnapshot, operations: Record<string, OperationRecord>): WorkflowEnvelopeDto {
  if (snapshot.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported workflow schema version: ${String(snapshot.schemaVersion)}`);
  }
  validateRevision(snapshot.revision);
  if (typeof snapshot.workflowId !== 'string' || snapshot.workflowId.trim().length === 0) {
    throw new TypeError('Workflow snapshot requires a non-empty workflowId');
  }
  if (!Array.isArray(snapshot.plans)) {
    throw new TypeError('Workflow snapshot plans must be an array');
  }
  for (let index = 0; index < snapshot.plans.length; index += 1) {
    if (!(index in snapshot.plans)) throw new TypeError('Workflow snapshot plans must be dense');
    validatePlan(snapshot.plans[index]);
  }
  const integrationMergeLease = snapshot.integrationMergeLease === undefined
    ? undefined
    : assertLease(snapshot.integrationMergeLease, 'Workflow integration merge lease', 'integration-merge') as IntegrationMergeLease;
  const value: WorkflowEnvelopeValue = {
    plans: snapshot.plans.map((plan) => {
      const validatedPlan = validatePlan(plan);
      return {
        id: validatedPlan.id,
        title: validatedPlan.title,
        status: validatedPlan.status,
        metadata: sanitizeJson(validatedPlan.metadata),
        ...(validatedPlan.executionLease === undefined
          ? {}
          : { executionLease: sanitizeJson(validatedPlan.executionLease) }),
      };
    }),
    ...(integrationMergeLease === undefined ? {} : { integrationMergeLease: sanitizeJson(integrationMergeLease) }),
    ...(Object.keys(operations).length === 0 ? {} : { operations: sanitizeJson(operations) as Record<string, unknown> }),
  };
  return createCanonicalArtifact({
    artifactKind: 'workflow',
    workflowId: snapshot.workflowId,
    revision: snapshot.revision,
    value,
    observedAt: snapshot.updatedAt ?? new Date().toISOString(),
  });
}

export class JsonArtifactStore implements ArtifactStore {

  public constructor(private readonly rootDirectory: string) {}

  private async readStoredWorkflow(workflowId: string): Promise<StoredWorkflow | null> {
    const path = workflowPath(this.rootDirectory, workflowId);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return null;
      throw error;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed) && parsed.artifactKind !== undefined) {
      const envelope = validateWorkflowEnvelope(parsed);
      if (envelope.dto.workflowId !== workflowId) throw new Error('Workflow artifact ID does not match requested workflowId');
      return { snapshot: toSnapshot(envelope.dto), operations: envelope.operations };
    }
    const dto = validateWorkflowDto(parsed);
    if (dto.workflowId !== workflowId) throw new Error('Workflow artifact ID does not match requested workflowId');
    return { snapshot: toSnapshot(dto), operations: {} };
  }

  public async readWorkflow(workflowId: string): Promise<WorkflowSnapshot | null> {
    const stored = await this.readStoredWorkflow(workflowId);
    return stored?.snapshot ?? null;
  }


  private async writeWorkflowInternal(
    expectedRevision: number,
    next: WorkflowSnapshot,
    operations: Record<string, OperationRecord> = {},
  ): Promise<void> {
    validateRevision(expectedRevision);
    if (!Number.isSafeInteger(expectedRevision + 1) || next.revision !== expectedRevision + 1) {
      throw new Error(`Workflow revision must advance exactly once: expected ${expectedRevision + 1}, received ${next.revision}`);
    }
    const destination = workflowPath(this.rootDirectory, next.workflowId);
    const directory = join(this.rootDirectory, 'workflows');
    await mkdir(directory, { recursive: true });
    const lockPath = `${destination}.lock`;
    await acquireWriteLock(lockPath);
    try {
      const current = await this.readStoredWorkflow(next.workflowId);
      const currentRevision = current?.snapshot.revision ?? 0;
      if (currentRevision !== expectedRevision) {
        throw new Error(`Workflow revision conflict: expected ${expectedRevision}, found ${currentRevision}`);
      }
      const preservedOperations = Object.keys(operations).length === 0
        ? current?.operations ?? {}
        : operations;
      const dto = toEnvelope(next, preservedOperations);
      const temporary = join(directory, `.${next.workflowId}.${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, `${JSON.stringify(dto, null, 2)}\n`, 'utf8');
        await rename(temporary, destination);
      } finally {
        await rm(temporary, { force: true });
      }
    } finally {
      await rm(lockPath, { force: true });
    }
  }
  public async writeWorkflowConditional(request: WorkflowWriteRequest): Promise<WorkflowWriteResult> {
    if (request.operationId.trim().length === 0
      || request.idempotencyKey.trim().length === 0
      || request.inputDigest.trim().length === 0) {
      return {
        kind: 'rejected',
        operationId: request.operationId,
        revision: request.expectedRevision,
        violations: [{ code: 'artifact.request.identity.invalid' }],
        recoveryActions: [{ code: 'artifact.request.identity.provide' }],
      };
    }
    const key = `${request.next.workflowId}:${request.idempotencyKey}`;
    const current = await this.readStoredWorkflow(request.next.workflowId);
    const previous = current?.operations[key];
    if (previous !== undefined) {
      if (previous.inputDigest === request.inputDigest) {
        return {
          kind: 'applied',
          operationId: previous.operationId,
          revision: previous.snapshot.revision,
          value: previous.snapshot,
        };
      }
      return {
        kind: 'rejected',
        operationId: request.operationId,
        revision: current?.snapshot.revision ?? 0,
        violations: [{ code: 'artifact.idempotency.digest-conflict' }],
        recoveryActions: [{ code: 'artifact.idempotency.new-key' }],
      };
    }
    const effectiveNext: WorkflowSnapshot = {
      ...request.next,
      updatedAt: request.next.updatedAt ?? new Date().toISOString(),
    };
    const operations = {
      ...(current?.operations ?? {}),
      [key]: {
        operationId: request.operationId,
        inputDigest: request.inputDigest,
        snapshot: effectiveNext,
      },
    };
    try {
      await this.writeWorkflowInternal(request.expectedRevision, effectiveNext, operations);
      const stored = await this.readStoredWorkflow(request.next.workflowId);
      if (stored === null) throw new Error('Workflow artifact disappeared after write');
      const result: WorkflowWriteResult = {
        kind: 'applied',
        operationId: request.operationId,
        revision: stored.snapshot.revision,
        value: stored.snapshot,
      };
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!message.includes('revision conflict') && !message.includes('write lock conflict')) throw error;
      const latest = await this.readStoredWorkflow(request.next.workflowId);
      const lockConflict = message.includes('write lock conflict');
      return {
        kind: 'conflict',
        operationId: request.operationId,
        revision: latest?.snapshot.revision ?? 0,
        violations: [{ code: lockConflict ? 'artifact.write.lock-conflict' : 'artifact.revision.conflict', message }],
        recoveryActions: [{ code: lockConflict ? 'artifact.write.retry-after-owner-releases' : 'artifact.revision.reread' }],
      };
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
