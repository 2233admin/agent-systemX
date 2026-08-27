import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { isRfc3339Timestamp } from '../../core/result';
import { validateArtifactRevision } from '../../core/ids';
import { isPlanStatus, type ExecutionLease, type IntegrationMergeLease, type PlanRow, type WorkflowSnapshot } from '../../domain/workflow';
import { validateLease as isCanonicalLease } from '../../domain/lease';
import type { ArtifactStore } from '../../ports/artifacts';

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
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function privateKey(value: string): boolean {
  // 先检查原始 Unicode key，再做兼容性归一化，避免 task正文 等动态字段逃逸。
  const raw = value.trim().toLowerCase();
  if (raw.includes('task正文') || raw.includes('prompt正文') || raw.includes('task body') || raw.includes('prompt body')) {
    return true;
  }
  const normalized = raw.normalize('NFKC').replace(/[^a-zA-Z0-9]/g, '');
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
  return value as unknown as WorkflowDto;
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

function toDto(snapshot: WorkflowSnapshot): WorkflowDto {
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
  const updatedAt = new Date().toISOString();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    revision: snapshot.revision,
    workflowId: snapshot.workflowId,
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
    ...(integrationMergeLease === undefined ? {} : { integrationMergeLease }),
    updatedAt,
  };
}

export class JsonArtifactStore implements ArtifactStore {
  public constructor(private readonly rootDirectory: string) {}

  public async readWorkflow(workflowId: string): Promise<WorkflowSnapshot | null> {
    const path = workflowPath(this.rootDirectory, workflowId);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
    const dto = validateWorkflowDto(JSON.parse(raw) as unknown);
    if (dto.workflowId !== workflowId) {
      throw new Error('Workflow artifact ID does not match requested workflowId');
    }
    return toSnapshot(dto);
  }

  public async writeWorkflow(expectedRevision: number, next: WorkflowSnapshot): Promise<void> {
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
      const current = await this.readWorkflow(next.workflowId);
      const currentRevision = current?.revision ?? 0;
      if (currentRevision !== expectedRevision) {
        throw new Error(`Workflow revision conflict: expected ${expectedRevision}, found ${currentRevision}`);
      }

      const dto = toDto(next);
      const temporary = join(directory, `.${next.workflowId}.${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, `${JSON.stringify(dto, null, 2)}\n`, 'utf8');
        await rename(temporary, destination);
      } finally {
        await rm(temporary, { force: true });
      }
    } finally {
      // 只在持有者退出写入流程后清理锁；不自动删除未知遗留锁，避免破坏活跃写入。
      await rm(lockPath, { force: true });
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
