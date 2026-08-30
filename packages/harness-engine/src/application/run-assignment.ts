import { createHash } from 'node:crypto';
import type { EvidenceRef, Unknown, Violation } from '../core/result.ts';
import type { ControlPlaneFacade, ControlPlaneUnknown } from './control-plane-port.ts';
import type { OrcaExecutionPort, OrcaWorkerResult } from '../ports/orca-execution.ts';
import type { ProcessPort } from '../ports/process.ts';

export interface RunAssignment {
  readonly schemaVersion: 1;
  readonly workflowId: string;
  readonly planId: string;
  readonly taskId: string;
  readonly objective: string;
  readonly worktreePath: string;
  readonly branch: string;
  readonly baseSha: string;
  readonly revisionId: string;
  readonly client: 'omp';
  readonly runId: string;
  readonly testCommand: readonly string[];
}

export interface RunAssignmentDependencies {
  readonly controlPlane: ControlPlaneFacade;
  readonly orca: OrcaExecutionPort;
  readonly process: ProcessPort;
}

export interface RunAssignmentResult {
  readonly status: 'pass' | 'blocked' | 'not-available' | 'fail';
  readonly summary: string;
  readonly identity: Partial<Pick<RunAssignment, 'workflowId' | 'planId' | 'taskId' | 'runId' | 'revisionId' | 'client'>>;
  readonly orca?: { readonly dispatchId: string; readonly workerId?: string; readonly deliveryId?: string; readonly status: string; readonly command: readonly string[] };
  readonly worktree?: { readonly path: string; readonly branch: string; readonly base: string; readonly head: string; readonly reviewRange: string };
  readonly diff?: { readonly status: 'changed' | 'clean'; readonly files: readonly string[] };
  readonly objectiveBinding?: { readonly source: 'orca.task.spec'; readonly taskId: string };
  readonly capability?: { readonly clientId: string; readonly clientVersion: string; readonly status: string; readonly reasonCode?: string };
  readonly tests?: { readonly status: 'passed' | 'failed'; readonly command: readonly string[]; readonly exitCode: number | null };
  readonly evidence: readonly EvidenceRef[];
  readonly violations: readonly Violation[];
  readonly recovery: readonly string[];
  readonly code?: string;
}

const ALLOWED_FIELDS = new Set([
  'schemaVersion', 'workflowId', 'planId', 'taskId', 'objective', 'worktreePath', 'branch', 'baseSha',
  'revisionId', 'client', 'runId', 'testCommand',
]);
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const TERMINAL_FAILURE = new Set(['failed', 'error', 'cancelled', 'disconnected', 'timeout']);
const EXPECTED_OMP_NATIVE_UNSUPPORTED = 'omp-native-interface-has-no-agent-system-config-concept';
const TERMINAL_SUCCESS = new Set(['done', 'completed', 'success', 'succeeded']);

function identity(assignment: RunAssignment): RunAssignmentResult['identity'] {
  return {
    workflowId: assignment.workflowId,
    planId: assignment.planId,
    taskId: assignment.taskId,
    runId: assignment.runId,
    revisionId: assignment.revisionId,
    client: assignment.client,
  };
}

function failure(
  assignment: RunAssignment,
  status: RunAssignmentResult['status'],
  code: string,
  summary: string,
  recovery: readonly string[],
  violations: readonly Violation[] = [{ code }],
  evidence: readonly EvidenceRef[] = [],
): RunAssignmentResult {
  return { status, summary, identity: identity(assignment), evidence, violations, recovery, code };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknown(value: unknown): value is ControlPlaneUnknown {
  return record(value) && value.kind === 'unknown';
}

function validCommand(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every((part) => typeof part === 'string' && part.trim().length > 0);
}

export function parseRunAssignment(value: unknown): RunAssignment | RunAssignmentResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { status: 'fail', summary: 'Assignment is rejected: expected a JSON object', identity: {}, evidence: [], violations: [{ code: 'assignment.shape.invalid' }], recovery: ['provide a V0 assignment JSON object'], code: 'assignment.shape.invalid' };
  }
  const candidate = value as Record<string, unknown>;
  const violations: Violation[] = [];
  for (const key of Object.keys(candidate)) if (!ALLOWED_FIELDS.has(key)) violations.push({ code: `assignment.field.unknown.${key}` });
  if (candidate.schemaVersion !== 1) violations.push({ code: 'assignment.schema-version.unsupported' });
  for (const field of ['workflowId', 'planId', 'taskId', 'objective', 'worktreePath', 'branch', 'baseSha', 'revisionId', 'runId']) {
    if (typeof candidate[field] !== 'string' || candidate[field].trim().length === 0) violations.push({ code: `assignment.${field}.missing` });
  }
  if (candidate.client !== 'omp') violations.push({ code: 'assignment.client.unsupported' });
  if (!SHA_PATTERN.test(typeof candidate.baseSha === 'string' ? candidate.baseSha : '')) violations.push({ code: 'assignment.base-sha.invalid' });
  if (!validCommand(candidate.testCommand)) violations.push({ code: 'assignment.test-command.missing' });
  if (violations.length > 0) {
    const partial = candidate as Partial<RunAssignment>;
    return failure(partial as RunAssignment, 'fail', violations[0]?.code ?? 'assignment.invalid', 'Assignment is rejected: required V0 fields are missing or invalid', ['repair the assignment JSON'], violations);
  }
  return candidate as unknown as RunAssignment;
}

function evidenceFrom(value: { source: string; observedAt: string }, locator: string): EvidenceRef {
  return { source: value.source, observedAt: value.observedAt, locator };
}

function unknownEvidence(value: { observedAt: string }, source: string, locator: string): EvidenceRef {
  return { source, observedAt: value.observedAt, locator };
}

function sameBranch(observed: string | undefined, expected: string): boolean {
  if (observed === undefined) return true;
  const normalize = (value: string): string => value.replace(/^refs\/heads\//, '');
  return normalize(observed) === normalize(expected);
}

function parseDiff(stdout: string): readonly string[] {
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0).map((line) => {
    const fields = line.split(/\s+/);
    return fields[fields.length - 1] ?? line;
  });
}

export async function runAssignment(assignment: RunAssignment, dependencies: RunAssignmentDependencies): Promise<RunAssignmentResult> {
  const identityResult = identity(assignment);
  const revision = await dependencies.controlPlane.readConfigRevision(assignment.revisionId, assignment.client);
  if (unknown(revision)) return failure(assignment, 'not-available', revision.reasonCode, 'Harness run is not available: config revision is unknown', [revision.recovery], [], [unknownEvidence(revision, 'control-plane', 'control-plane.revision')]);
  const manifest = await dependencies.controlPlane.readAssemblyManifest(assignment.revisionId, assignment.client);
  if (unknown(manifest)) return failure(assignment, 'not-available', manifest.reasonCode, 'Harness run is not available: assembly manifest is unknown', [manifest.recovery], [], [unknownEvidence(manifest, 'control-plane', 'control-plane.manifest')]);
  const capability = await dependencies.controlPlane.probeClient(assignment.client);
  if (unknown(capability)) return failure(assignment, 'not-available', capability.reasonCode, 'Harness run is not available: OMP capability is unknown', [capability.recovery], [], [unknownEvidence(capability, 'control-plane', 'control-plane.capability')]);
  // OMP's native config/status-view capability is intentionally unsupported; worker execution remains valid.
  const nativeConfigUnsupported = capability.clientId === 'omp'
    && capability.status === 'unsupported'
    && capability.reasonCode === EXPECTED_OMP_NATIVE_UNSUPPORTED;
  if (capability.status !== 'supported' && !nativeConfigUnsupported) return failure(assignment, 'blocked', capability.reasonCode ?? 'control-plane.client.unsupported', 'Harness run is blocked: OMP capability is not supported', ['obtain supported OMP capability evidence'], [{ code: capability.reasonCode ?? 'control-plane.client.unsupported' }], [evidenceFrom(capability, 'control-plane.capability')]);
  const launch = await dependencies.controlPlane.prepareLaunch(assignment.revisionId, assignment.client);
  if (unknown(launch)) return failure(assignment, 'not-available', launch.reasonCode, 'Harness run is not available: launch plan is unknown', [launch.recovery], [], [unknownEvidence(launch, 'control-plane', 'control-plane.launch')]);


  let baseCheck;
  try { baseCheck = await dependencies.process.run('git', ['rev-parse', '--verify', assignment.baseSha], assignment.worktreePath); } catch { return failure(assignment, 'not-available', 'git.base.unavailable', 'Harness run is not available: base SHA could not be read', ['provide an existing worktree and concrete base SHA']); }
  if (baseCheck.exitCode !== 0 || baseCheck.stdout.trim() !== assignment.baseSha) return failure(assignment, 'blocked', 'git.base.mismatch', 'Harness run is blocked: worktree base does not match the assignment', ['reconcile the existing worktree with the assignment base SHA']);

  const worker = await dependencies.orca.runWorker({ ...assignment });
  if (worker.kind === 'unknown') return failure(assignment, 'not-available', worker.reasonCode, 'Harness run is not available: Orca worker could not be started or read', [worker.recovery ?? 'start Orca and retry'], [], [unknownEvidence(worker, 'orca.cli', 'orca.worker')]);
  const workerValue: OrcaWorkerResult = worker.value;
  const workerEvidence = worker.evidence;
  const orcaReceipt = { dispatchId: workerValue.dispatchId, workerId: workerValue.workerId, deliveryId: workerValue.deliveryId, status: workerValue.status, command: workerValue.command };
  if (workerValue.runId !== assignment.runId || workerValue.taskId !== assignment.taskId) return failure(assignment, 'blocked', 'orca.identity.mismatch', 'Harness run is blocked: Orca receipt identity does not match the assignment', ['re-read the exact Orca run and task IDs'], [{ code: 'orca.identity.mismatch' }], [workerEvidence]);
  if (TERMINAL_FAILURE.has(workerValue.status.toLowerCase())) return { ...failure(assignment, 'fail', 'orca.worker.failed', 'Harness run failed: the Orca worker reached a terminal failure state', ['inspect the exact Orca worker result before retrying'], [{ code: 'orca.worker.failed' }], [workerEvidence]), orca: orcaReceipt };
  if (!TERMINAL_SUCCESS.has(workerValue.status.toLowerCase())) return failure(assignment, 'blocked', 'orca.worker.not-complete', 'Harness run is blocked: Orca accepted the worker but it did not complete', ['read the exact Orca worker again after completion'], [{ code: 'orca.worker.not-complete' }], [workerEvidence]);
  if (workerValue.worktreePath !== assignment.worktreePath) return failure(assignment, 'blocked', 'orca.worktree.mismatch', 'Harness run is blocked: worker receipt points at a different worktree', ['reconcile the existing worktree path before retrying'], [{ code: 'orca.worktree.mismatch' }], [workerEvidence]);
  if (workerValue.branch === undefined) return failure(assignment, 'blocked', 'orca.branch.missing', 'Harness run is blocked: worker branch evidence is missing', ['read the exact worker branch before retrying'], [{ code: 'orca.branch.missing' }], [workerEvidence]);
  if (!sameBranch(workerValue.branch, assignment.branch)) return failure(assignment, 'blocked', 'orca.branch.mismatch', 'Harness run is blocked: worker receipt points at a different branch', ['reconcile the existing branch before retrying'], [{ code: 'orca.branch.mismatch' }], [workerEvidence]);

  let headCheck;
  try { headCheck = await dependencies.process.run('git', ['rev-parse', '--verify', 'HEAD'], assignment.worktreePath); } catch { return failure(assignment, 'not-available', 'git.head.unavailable', 'Harness run is not available: worker head could not be read', ['provide a readable existing worktree']); }
  const head = headCheck.stdout.trim();
  if (headCheck.exitCode !== 0 || !SHA_PATTERN.test(head)) return failure(assignment, 'not-available', 'git.head.invalid', 'Harness run is not available: worker head is not a concrete revision', ['read a concrete worker HEAD before retrying'], [], [workerEvidence]);
  let diffCheck;
  try { diffCheck = await dependencies.process.run('git', ['diff', '--no-ext-diff', '--name-status', `${assignment.baseSha}..${head}`], assignment.worktreePath); } catch { return failure(assignment, 'not-available', 'git.diff.unavailable', 'Harness run is not available: review range could not be read', ['read the existing worktree diff again']); }
  if (diffCheck.exitCode !== 0) return failure(assignment, 'not-available', 'git.diff.unavailable', 'Harness run is not available: review range could not be read', ['read the existing worktree diff again']);
  const files = parseDiff(diffCheck.stdout);
  let tests;
  try { tests = await dependencies.process.run(assignment.testCommand[0]!, assignment.testCommand.slice(1), assignment.worktreePath); } catch { return failure(assignment, 'not-available', 'tests.unavailable', 'Harness run is not available: test command could not be started', ['run the explicit argv test command in the existing worktree']); }
  const testOutcome = { status: tests.exitCode === 0 ? 'passed' as const : 'failed' as const, command: assignment.testCommand, exitCode: tests.exitCode };
  const evidence: EvidenceRef[] = [evidenceFrom(revision, 'control-plane.revision'), evidenceFrom(manifest, 'control-plane.manifest'), evidenceFrom(capability, 'control-plane.capability'), evidenceFrom(launch, 'control-plane.launch'), workerEvidence, { source: 'git', observedAt: new Date().toISOString(), locator: `${assignment.baseSha}..${head}` }, { source: 'tests', observedAt: new Date().toISOString(), locator: assignment.testCommand[0]! }];
  if (tests.exitCode !== 0) return {
    status: 'fail',
    summary: 'Harness run failed: worker completed but the explicit test command failed',
    identity: identityResult,
    capability,
    orca: orcaReceipt,
    worktree: { path: assignment.worktreePath, branch: assignment.branch, base: assignment.baseSha, head, reviewRange: `${assignment.baseSha}..${head}` },
    diff: { status: files.length > 0 ? 'changed' : 'clean', files },
    tests: testOutcome,
    evidence,
    violations: [{ code: 'tests.failed' }],
    recovery: ['fix the failing test command and rerun'],
  };
  return {
    status: 'pass',
    summary: 'Harness run completed: OMP worker, concrete review range, and tests passed',
    identity: identityResult,
    capability,
    orca: orcaReceipt,
    worktree: { path: assignment.worktreePath, branch: assignment.branch, base: assignment.baseSha, head, reviewRange: `${assignment.baseSha}..${head}` },
    diff: { status: files.length > 0 ? 'changed' : 'clean', files },
    tests: testOutcome,
    evidence,
    violations: [],
    recovery: [],
  };
}

export function digestAssignment(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}
