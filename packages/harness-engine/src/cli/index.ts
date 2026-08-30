import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import type { DispatchInput } from '../gates/dispatch.ts';
import { JsonArtifactStore } from '../adapters/json/json-artifact-store.ts';
import { createWorkflowFacade } from '../application/harness-application.ts';
import type { WorkflowCommandResult } from '../application/commands.ts';
import type { WorkflowSnapshot } from '../domain/workflow.ts';
import { runArtifactCommand, formatArtifactCommandResult } from './commands/artifact-commands.ts';
import { parseArtifactCommand } from './parsers/artifact-commands.ts';
import { collectRealSmokeEvidence } from '../smoke/evidence.ts';
import { createProductionHarnessControlPlaneFacade } from '@agent-system/control-plane/application/public-entry';
import type { ControlPlaneFacade } from '../application/control-plane-port.ts';
import { parseRunAssignment, runAssignment } from '../application/run-assignment.ts';
import type { RunAssignment, RunAssignmentDependencies, RunAssignmentResult } from '../application/run-assignment.ts';
import type { OrcaExecutionPort } from '../ports/orca-execution.ts';
import type { ProcessPort } from '../ports/process.ts';
import { OrcaCliExecutionAdapter } from '../adapters/orca/orca-cli-execution-adapter.ts';
import { BunProcessPort } from '../adapters/process/bun-process-port.ts';

export interface RunCliDependencies {
  readonly controlPlane: ControlPlaneFacade;
  readonly orca: OrcaExecutionPort;
  readonly process: ProcessPort;
}

type RunCliOptions = RunCliDependencies;

function runResultCode(result: RunAssignmentResult): 0 | 1 {
  return result.status === 'pass' ? 0 : 1;
}

function renderRun(result: RunAssignmentResult, json: boolean): CliResult {
  if (json) return { exitCode: runResultCode(result), stdout: `${JSON.stringify(result)}\n`, stderr: '' };
  return {
    exitCode: runResultCode(result),
    stdout: `${result.summary}\nstatus: ${result.status}\nworkflow: ${result.identity.workflowId ?? 'unknown'}\nplan: ${result.identity.planId ?? 'unknown'}\ntask: ${result.identity.taskId ?? 'unknown'}\nrun: ${result.identity.runId ?? 'unknown'}\n`,
    stderr: '',
  };
}

async function runAssignmentCli(filePath: string, json: boolean, options?: RunCliOptions): Promise<CliResult> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return renderRun({
      status: 'not-available',
      summary: 'Harness run is not available: assignment file could not be read',
      identity: {} as RunAssignmentResult['identity'],
      evidence: [],
      violations: [{ code: 'assignment.file.unreadable' }],
      recovery: ['provide a readable assignment JSON file'],
      code: 'assignment.file.unreadable',
    }, json);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return renderRun({
      status: 'fail',
      summary: 'Harness run is rejected: assignment JSON is malformed',
      identity: {},
      evidence: [],
      violations: [{ code: 'assignment.json.invalid' }],
      recovery: ['repair the assignment JSON'],
      code: 'assignment.json.invalid',
    }, json);
  }
  const assignment = parseRunAssignment(parsed);
  if (!('schemaVersion' in assignment)) return renderRun(assignment, json);
  const dependencies: RunAssignmentDependencies = {
    controlPlane: options?.controlPlane ?? await createProductionHarnessControlPlaneFacade(),
    orca: options?.orca ?? new OrcaCliExecutionAdapter(),
    process: options?.process ?? new BunProcessPort(),
  };
  return renderRun(await runAssignment(assignment as RunAssignment, dependencies), json);
}

export interface CliResult {
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
}

function usage(): string {
  return 'usage: harness run <assignment.json> [--json] | harness validate <assignment-file> | harness status <workflow-file>';
}

function failureBlock(
  phase: 'validate' | 'status',
  code: string,
  recovery: string,
  kind = 'fail',
): string {
  return [
    'status: fail',
    `phase: ${phase}`,
    `evidence: unknown`,
    `kind: ${kind}`,
    `code: ${code}`,
    `recovery: ${recovery}`,
  ].join('\n');
}

function assignmentInput(raw: string, filePath: string): DispatchInput {
  if (extname(filePath).toLowerCase() !== '.json') return { assignment: raw };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { assignment: raw };
  }
  if (typeof parsed === 'string') return { assignment: parsed };
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { assignment: raw };
  const record = parsed as Record<string, unknown>;
  const assignment = typeof record.assignment === 'string'
    ? record.assignment
    : typeof record.assignmentText === 'string'
      ? record.assignmentText
      : undefined;
  return {
    ...record,
    ...(assignment === undefined ? {} : { assignment }),
  } as DispatchInput;
}

function renderValidationResult(result: WorkflowCommandResult<unknown>): CliResult {
  if (result.kind === 'applied') return { exitCode: 0, stdout: 'status: pass\nphase: validate\n', stderr: '' };
  const codes = result.violations.map((violation) => violation.code).join(', ');
  const recovery = result.recoveryActions
    .map((action) => action.description)
    .filter((description): description is string => description !== undefined)
    .join('; ');
  return {
    exitCode: 1,
    stdout: `${failureBlock('validate', codes, recovery || 'provide valid local validation input', result.kind)}\n`,
    stderr: '',
  };
}

async function validateAssignment(filePath: string): Promise<CliResult> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return {
      exitCode: 1,
      stdout: `${failureBlock('validate', 'assignment.file.unreadable', 'provide a readable assignment file')}\n`,
      stderr: '',
    };
  }
  const inputDigest = createHash('sha256').update(raw, 'utf8').digest('hex');
  const facade = createWorkflowFacade(new JsonArtifactStore(dirname(resolve(filePath))));
  return renderValidationResult(await facade.validate({
    operationId: `cli-validate:${filePath}`,
    actorId: 'harness-cli',
    expectedRevision: 0,
    idempotencyKey: `cli-validate:${filePath}`,
    inputDigest,
    assignment: assignmentInput(raw, filePath),
  }));
}

function renderLease(plan: WorkflowSnapshot['plans'][number]): string {
  return plan.executionLease === undefined ? 'none' : 'execution';
}

function renderStatus(snapshot: WorkflowSnapshot): CliResult {
  const lines = [
    `workflow: ${snapshot.workflowId}`,
    `revision: ${snapshot.revision}`,
  ];
  for (const plan of snapshot.plans) {
    lines.push(`plan: ${plan.id}`, `status: ${plan.status}`, `lease: ${renderLease(plan)}`);
  }
  lines.push(`integration-merge-lease: ${snapshot.integrationMergeLease === undefined ? 'none' : 'integration-merge'}`);
  return { exitCode: 0, stdout: `${lines.join('\n')}\n`, stderr: '' };
}

function workflowFailure(error: unknown): CliResult {
  const message = error instanceof Error ? error.message : '';
  const code = message.startsWith('Unsupported future workflow schema version:')
    ? 'workflow.schema.future'
    : message.startsWith('Unsupported workflow schema version:')
      ? 'workflow.schema.unsupported'
      : 'workflow.artifact.malformed';
  return {
    exitCode: 1,
    stdout: `${failureBlock('status', code, 'repair the local versioned workflow artifact')}\n`,
    stderr: '',
  };
}

async function statusWorkflow(filePath: string): Promise<CliResult> {
  const absolute = isAbsolute(filePath) ? filePath : resolve(filePath);
  if (extname(absolute).toLowerCase() !== '.json') return workflowFailure(new TypeError('Workflow artifact must be a JSON file'));
  const workflowId = basename(absolute, '.json');
  let artifactRoot: string;
  let temporaryRoot: string | undefined;
  if (basename(dirname(absolute)).toLowerCase() === 'workflows') {
    artifactRoot = dirname(dirname(absolute));
  } else {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'harness-cli-'));
    artifactRoot = temporaryRoot;
    await mkdir(join(temporaryRoot, 'workflows'), { recursive: true });
    await Bun.write(join(temporaryRoot, 'workflows', `${workflowId}.json`), await readFile(absolute, 'utf8'));
  }
  try {
    const facade = createWorkflowFacade(new JsonArtifactStore(artifactRoot));
    const result = await facade.status({
      workflowId,
      operationId: `cli-status:${filePath}`,
      actorId: 'harness-cli',
      expectedRevision: 0,
      consistency: 'latest',
      idempotencyKey: `cli-status:${filePath}`,
      inputDigest: createHash('sha256').update(workflowId, 'utf8').digest('hex'),
    });
    if (result.kind !== 'applied' || result.value === undefined) {
      const code = result.violations.map((violation) => violation.code).join(', ') || 'workflow.artifact.missing';
      return { exitCode: 1, stdout: `${failureBlock('status', code, 'provide an existing workflow artifact', result.kind)}\n`, stderr: '' };
    }
    return renderStatus(result.value);
  } catch (error) {
    return workflowFailure(error);
  } finally {
    if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true });
  }
}
async function smokeEvidence(args: readonly string[]): Promise<CliResult> {
  if (args.length !== 9 || args[2] !== '--backend' || args[4] !== '--result' || args[6] !== '--missing' || args[7] === '') {
    return { exitCode: 2, stdout: '', stderr: 'usage: harness smoke evidence --backend <orca|github> --result not-available --missing <names> --json\n' };
  }
  const backend = args[3];
  const result = args[5];
  if ((backend !== 'orca' && backend !== 'github') || result !== 'not-available' || args[8] !== '--json') {
    return { exitCode: 2, stdout: '', stderr: 'usage: harness smoke evidence --backend <orca|github> --result not-available --missing <names> --json\n' };
  }
  const requiredEnv = (args[7] ?? '').split(',').filter((name) => name.length > 0);
  const correlation = {
    workflowId: 'unknown-workflow', planId: 'unknown-plan', operationId: `smoke-${backend}`, snapshotId: 'unknown-snapshot',
    attemptId: 'preflight', source: `real-smoke.${backend}`, sourceVersion: '1', observedAt: new Date().toISOString(),
  };
  const evidence = await collectRealSmokeEvidence({
    backend,
    adapterVersion: 'stage4-readonly',
    correlation,
    requiredEnv,
    environment: process.env,
    read: async () => ({ objectRefs: [], permission: 'read-only', network: 'unknown', readbackRefs: [], result: 'not-available' }),
  });
  return { exitCode: 0, stdout: `${JSON.stringify(evidence)}\n`, stderr: '' };
}


export async function runCli(args: readonly string[], options?: RunCliOptions): Promise<CliResult> {
  if (args[0] === 'smoke' && args[1] === 'evidence') return smokeEvidence(args);
  if (args[0] === 'artifact') {
    try { parseArtifactCommand(args); } catch { return { exitCode: 2, stdout: '', stderr: 'usage: harness artifact <path|status|project register|migrate> ... --json\n' }; }
    const result = await runArtifactCommand(args);
    return { exitCode: result.result === 'invalid' ? 1 : 0, stdout: formatArtifactCommandResult(result), stderr: '' };
  }
  if (args[0] === 'run') {
    if (args[1] === '--help' || args[1] === '-h') return { exitCode: 0, stdout: `${usage()}\n`, stderr: '' };
    const filePath = args[1];
    const json = args[2] === '--json';
    if (filePath === undefined || filePath.trim().length === 0 || args.length !== (json ? 3 : 2)) {
      return { exitCode: 2, stdout: '', stderr: `${usage()}\n` };
    }
    return runAssignmentCli(filePath, json, options);
  }
  const command = args[0];
  const filePath = args[1];
  if (args.length !== 2
    || (command !== 'validate' && command !== 'status')
    || filePath === undefined
    || filePath.trim().length === 0) {
    return { exitCode: 2, stdout: '', stderr: `${usage()}\n` };
  }
  return command === 'validate' ? validateAssignment(filePath) : statusWorkflow(filePath);
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const result = await runCli(args);
  if (result.stdout.length > 0) process.stdout.write(result.stdout);
  if (result.stderr.length > 0) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

if (import.meta.main) await main();
