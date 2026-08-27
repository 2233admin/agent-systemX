import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { validateDispatch, type DispatchDecision, type DispatchInput } from '../gates/dispatch.ts';
import { JsonArtifactStore } from '../adapters/json/json-artifact-store.ts';
import type { GateResult } from '../core/result.ts';
import type { WorkflowSnapshot } from '../domain/workflow.ts';

export interface CliResult {
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
}

const CLI_WORKFLOW_ID = 'harness-cli-workflow';
const CLI_PLAN_ID = 'harness-cli-plan';
const CLI_TASK_ID = 'harness-cli-task';
const CLI_WORKTREE = '/harness-cli/worktree';
const CLI_CLAIMED_AT = '2026-01-01T00:00:00.000Z';

function usage(): string {
  return 'usage: harness validate <assignment-file> | harness status <workflow-file>';
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

function dispatchDefaults(input: DispatchInput): DispatchInput {
  const hasOwn = (key: string): boolean => Object.hasOwn(input as object, key);
  const planId = hasOwn('planId') ? input.planId : CLI_PLAN_ID;
  const taskId = hasOwn('taskId') ? input.taskId : CLI_TASK_ID;
  const worktree = hasOwn('worktree')
    ? input.worktree
    : hasOwn('worktreePath')
      ? input.worktreePath
      : CLI_WORKTREE;

  return {
    ...input,
    planId,
    taskId,
    worktree,
    ...(hasOwn('branchProtection') ? {} : { branchProtection: { defaultBranch: 'main', protectedBranches: ['main', 'master'] } }),
    ...(hasOwn('hostCapability') ? {} : {
      hostCapability: {
        status: 'supported' as const,
        hostId: 'harness-cli',
        hostVersion: 'local',
        evidence: { source: 'harness-cli.local-host', observedAt: CLI_CLAIMED_AT, hostId: 'harness-cli', hostVersion: 'local' },
      },
    }),
    ...(hasOwn('leaseState') ? {} : {
      leaseState: {
        kind: 'execution' as const,
        workflowId: CLI_WORKFLOW_ID,
        planId: planId as string,
        holderId: 'harness-cli',
        worktreePath: worktree as string,
        fencingToken: 1,
        claimedAt: CLI_CLAIMED_AT,
      },
    }),
  };
}

function assignmentInput(raw: string, filePath: string): DispatchInput {
  if (extname(filePath).toLowerCase() !== '.json') {
    return dispatchDefaults({ assignment: raw });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return dispatchDefaults({ assignment: raw });
  }

  if (typeof parsed === 'string') {
    return dispatchDefaults({ assignment: parsed });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return dispatchDefaults({ assignment: raw });
  }
  const record = parsed as Record<string, unknown>;
  const assignment = typeof record.assignment === 'string'
    ? record.assignment
    : typeof record.assignmentText === 'string'
      ? record.assignmentText
      : undefined;
  return dispatchDefaults({
    ...record,
    ...(assignment === undefined ? {} : { assignment }),
  } as DispatchInput);
}

function renderValidationResult(result: GateResult<DispatchDecision>): CliResult {
  if (result.kind === 'pass') {
    return { exitCode: 0, stdout: 'status: pass\nphase: validate\n', stderr: '' };
  }
  const codes = result.violations.map((violation) => violation.code).join(', ');
  const recovery = result.recovery
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
  return renderValidationResult(validateDispatch(assignmentInput(raw, filePath)));
}

async function readWorkflow(filePath: string): Promise<WorkflowSnapshot | null> {
  const absolute = isAbsolute(filePath) ? filePath : resolve(filePath);
  const extension = extname(absolute);
  if (extension.toLowerCase() !== '.json') {
    throw new TypeError('Workflow artifact must be a JSON file');
  }
  const workflowId = basename(absolute, extension);
  if (extension === '.json' && basename(dirname(absolute)).toLowerCase() === 'workflows') {
    return new JsonArtifactStore(dirname(dirname(absolute))).readWorkflow(workflowId);
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'harness-cli-'));
  try {
    const temporaryWorkflows = join(temporaryRoot, 'workflows');
    await mkdir(temporaryWorkflows);
    await copyFile(absolute, join(temporaryWorkflows, `${workflowId}.json`));
    return await new JsonArtifactStore(temporaryRoot).readWorkflow(workflowId);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
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
  try {
    const snapshot = await readWorkflow(filePath);
    if (snapshot === null) {
      return {
        exitCode: 1,
        stdout: `${failureBlock('status', 'workflow.artifact.missing', 'provide an existing workflow artifact')}\n`,
        stderr: '',
      };
    }
    return renderStatus(snapshot);
  } catch (error) {
    return workflowFailure(error);
  }
}

export async function runCli(args: readonly string[]): Promise<CliResult> {
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

if (import.meta.main) {
  await main();
}
