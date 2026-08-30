import { spawn } from 'node:child_process';
import type { Known, Unknown } from '../../core/result.ts';
import type { OrcaExecutionPort, OrcaWorkerRequest, OrcaWorkerResult } from '../../ports/orca-execution.ts';

export interface OrcaCommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type OrcaCommandRunner = (command: string, args: readonly string[]) => Promise<OrcaCommandResult>;

const TERMINAL_STATUSES = new Set(['done', 'completed', 'failed', 'error', 'cancelled', 'disconnected']);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknown(reasonCode: string, recovery: string): Unknown {
  return { kind: 'unknown', reasonCode, observedAt: new Date().toISOString(), recovery };
}

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    return undefined;
  }
}

function findString(value: unknown, keys: readonly string[], depth = 0): string | undefined {
  if (depth > 6 || !record(value)) return undefined;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate;
  }
  for (const child of Object.values(value)) {
    const found = findString(child, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}
function findDispatchId(value: unknown, depth = 0): string | undefined {
  if (depth > 7 || !record(value)) return undefined;
  const direct = value.dispatchId ?? value.dispatch_id;
  if (typeof direct === 'string' && direct.trim().length > 0) return direct;
  if (record(value.dispatch) && typeof value.dispatch.id === 'string' && value.dispatch.id.trim().length > 0) return value.dispatch.id;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'id') continue;
    const found = findDispatchId(child, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}
interface TaskMatch {
  readonly spec: string;
  readonly runId?: string;
}

function findTaskMatches(value: unknown, taskId: string, matches: TaskMatch[] = [], depth = 0): readonly TaskMatch[] {
  if (depth > 7) return matches;
  if (Array.isArray(value)) {
    for (const child of value) findTaskMatches(child, taskId, matches, depth + 1);
    return matches;
  }
  if (!record(value)) return matches;
  const id = value.id ?? value.taskId ?? value.task_id;
  if (id === taskId && typeof value.spec === 'string' && value.spec.trim().length > 0) {
    const runId = typeof value.runId === 'string' ? value.runId : typeof value.run_id === 'string' ? value.run_id : undefined;
    matches.push({ spec: value.spec, ...(runId === undefined ? {} : { runId }) });
  }
  for (const child of Object.values(value)) findTaskMatches(child, taskId, matches, depth + 1);
  return matches;
}

function settled(value: string | undefined): boolean {
  return value !== undefined && TERMINAL_STATUSES.has(value.toLowerCase());
}

async function defaultCommandRunner(command: string, args: readonly string[]): Promise<OrcaCommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (exitCode, signal) => resolve({ exitCode: exitCode ?? (signal === null ? 1 : null), stdout, stderr }));
  });
}

/** Real Orca CLI adapter. It never creates, removes, or steals a worktree. */
export class OrcaCliExecutionAdapter implements OrcaExecutionPort {
  public constructor(
    private readonly command = process.env.ORCA_CLI_COMMAND ?? 'orca',
    private readonly runCommand: OrcaCommandRunner = defaultCommandRunner,
    private readonly pollIntervalMs = 250,
    private readonly timeoutMs = 300_000,
  ) {}

  public async runWorker(request: OrcaWorkerRequest): Promise<Known<OrcaWorkerResult> | Unknown> {
    const workerCommand = [
      'orchestration', 'worker-start', '--run', request.runId, '--task', request.taskId,
      '--worktree', `path:${request.worktreePath}`, '--agent', request.client, '--json',
    ];
    const taskList = await this.invoke(['orchestration', 'task-list', '--run', request.runId, '--json']);
    if (taskList === undefined) return unknown('orca.task-list.unavailable', 'read the assigned Orca task again');
    // `task-list --run` scopes the collection; Orca may omit run_id on each task.
    // The response-level runId is therefore the required run binding.
    const taskRunId = findString(taskList, ['runId', 'run_id']);
    if (taskRunId !== request.runId) return unknown('orca.task.identity-mismatch', 'read the task list for the exact Orca run again');
    const taskMatches = findTaskMatches(taskList, request.taskId);
    if (taskMatches.length === 0) return unknown('orca.task.shape-invalid', 'read the exact Orca task and its immutable spec');
    if (taskMatches.length > 1) return unknown('orca.task.ambiguous', 'narrow the Orca task list to one exact task identity');
    const taskMatch = taskMatches[0]!;
    if (taskMatch.runId !== undefined && taskMatch.runId !== request.runId) return unknown('orca.task.identity-mismatch', 'read the task list for the exact Orca run again');
    if (taskMatch.spec !== request.objective) return unknown('orca.task.objective-mismatch', 'reconcile assignment objective with the pre-created Orca task');
    const started = await this.invoke(workerCommand);
    if (started === undefined) return unknown('orca.worker-start.unavailable', 'start Orca and retry the worker');
    const dispatchId = findString(started, ['dispatchId', 'dispatch_id']);
    if (dispatchId === undefined) return unknown('orca.worker-start.shape-invalid', 'inspect the Orca worker-start response and retry');
    const startedRunId = findString(started, ['runId', 'run_id']);
    const startedTaskId = findString(started, ['taskId', 'task_id']);
    if (startedRunId !== request.runId || startedTaskId !== request.taskId) {
      return unknown('orca.worker-start.identity-mismatch', 'discard the receipt and start only the exact assigned task');
    }

    const deadline = Date.now() + this.timeoutMs;
    let observed = started;
    let status = 'accepted';
    let verifiedRunId: string | undefined;
    let verifiedTaskId: string | undefined;
    let verifiedDispatchId: string | undefined;
    while (!settled(status)) {
      if (Date.now() >= deadline) return unknown('orca.worker.timeout', 'read the worker again after it reaches a terminal state');
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
      const snapshot = await this.invoke(['orchestration', 'worker-show', '--dispatch', dispatchId, '--json']);
      if (snapshot === undefined) return unknown('orca.worker-show.unavailable', 'read the correlated Orca worker again');
      observed = snapshot;
      status = findString(snapshot, ['status', 'state']) ?? status;
      const observedRunId = findString(snapshot, ['runId', 'run_id']);
      const observedTaskId = findString(snapshot, ['taskId', 'task_id']);
      const observedDispatchId = findDispatchId(snapshot);
      if (observedRunId !== request.runId || observedTaskId !== request.taskId || observedDispatchId !== dispatchId) {
        return unknown('orca.worker-show.identity-mismatch', 'discard the snapshot and read the exact dispatch again');
      }
      verifiedRunId = observedRunId;
      verifiedTaskId = observedTaskId;
      verifiedDispatchId = observedDispatchId;
    }
    if (verifiedRunId === undefined || verifiedTaskId === undefined || verifiedDispatchId === undefined) {
      return unknown('orca.worker-show.identity-missing', 'read a concrete worker-show receipt before accepting delivery');
    }

    const readback = await this.invoke([
      'orchestration', 'worker-read', '--dispatch', dispatchId, '--source', 'auto', '--limit', '1000', '--json',
    ]);
    if (readback === undefined) return unknown('orca.worker-read.unavailable', 'read the correlated worker delivery again');
    const readbackRunId = findString(readback, ['runId', 'run_id']);
    const readbackTaskId = findString(readback, ['taskId', 'task_id']);
    const readbackDispatchId = findString(readback, ['dispatchId', 'dispatch_id']);
    const hasReadbackIdentity = readbackRunId !== undefined || readbackTaskId !== undefined || readbackDispatchId !== undefined;
    if (hasReadbackIdentity && (readbackRunId !== verifiedRunId || readbackTaskId !== verifiedTaskId || readbackDispatchId !== verifiedDispatchId)) {
      return unknown('orca.worker-read.identity-mismatch', 'discard the readback and request the exact correlated delivery');
    }

    const workerId = findString(observed, ['workerId', 'worker_id']);
    const deliveryId = findString(observed, ['deliveryId', 'delivery_id']);
    const worktreePath = findString(observed, ['worktreePath', 'worktree_path']);
    const branch = findString(observed, ['branch']);
    const value: OrcaWorkerResult = {
      runId: verifiedRunId,
      taskId: verifiedTaskId,
      dispatchId: verifiedDispatchId,
      ...(branch === undefined ? {} : { branch }),
      ...(workerId === undefined ? {} : { workerId }),
      ...(deliveryId === undefined ? {} : { deliveryId }),
      status,
      ...(worktreePath === undefined ? {} : { worktreePath }),
      command: [this.command, ...workerCommand],
    };
    return {
      kind: 'known',
      value,
      evidence: { source: 'orca.cli', observedAt: new Date().toISOString(), locator: dispatchId },
    };
  }

  private async invoke(args: readonly string[]): Promise<unknown | undefined> {
    let response: OrcaCommandResult;
    try {
      response = await this.runCommand(this.command, args);
    } catch {
      return undefined;
    }
    if (response.exitCode !== 0) return undefined;
    return parseJson(response.stdout);
  }
}
