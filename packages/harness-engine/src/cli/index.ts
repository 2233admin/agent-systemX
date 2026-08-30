import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { createFileHarnessApplication, ApplicationCommandError } from '../application/harness-application.ts';
import type { FileInput } from '../application/identity.ts';
import type { StatusView } from '../application/queries.ts';
import type { DispatchInput } from '../gates/dispatch.ts';
import type { GateResult } from '../core/result.ts';
import type { DispatchDecision } from '../gates/dispatch.ts';
import type { WorkflowSnapshot } from '../domain/workflow.ts';

export interface CliResult {
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
}

type JsonRecord = Record<string, unknown>;

function usage(): string {
  return 'usage: harness validate <assignment-file> | harness status <workflow-file> | harness <create|read|register-plan|register-assignment|transition-plan|claim-lease|release-lease|append-completion-evidence> <input-json>';
}

function failureBlock(
  phase: string,
  code: string,
  recovery: string,
  kind = 'fail',
): string {
  return [
    'status: fail',
    `phase: ${phase}`,
    'evidence: unknown',
    `kind: ${kind}`,
    `code: ${code}`,
    `recovery: ${recovery}`,
  ].join('\n');
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownFileInput(sourcePath: string): FileInput {
  return {
    artifactRoot: dirname(sourcePath),
    workflowId: 'Unknown',
    actorId: 'Unknown',
    inputDigest: 'Unknown',
  };
}

function fileInputFromWorkflowPath(absolute: string): FileInput {
  const extension = extname(absolute);
  return {
    artifactRoot: dirname(dirname(absolute)),
    workflowId: basename(absolute, extension),
    actorId: 'Unknown',
    inputDigest: `file:${absolute}`,
  };
}

function assignmentInput(raw: string, _filePath: string): DispatchInput {

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { assignment: raw };
  }

  if (typeof parsed === 'string') {
    return { assignment: parsed };
  }
  if (!isJsonRecord(parsed)) {
    return { assignment: raw };
  }
  const assignment = typeof parsed.assignment === 'string'
    ? parsed.assignment
    : typeof parsed.assignmentText === 'string'
      ? parsed.assignmentText
      : undefined;
  return {
    ...parsed,
    ...(assignment === undefined ? {} : { assignment }),
  } as DispatchInput;
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
  const absolute = isAbsolute(filePath) ? filePath : resolve(filePath);
  const app = createFileHarnessApplication(unknownFileInput(absolute));
  return renderValidationResult((await app.validate(assignmentInput(raw, filePath))).result);
}

function renderStatus(view: StatusView): CliResult {
  const lines = [
    `workflow: ${view.workflowId}`,
    `revision: ${view.revision}`,
  ];
  for (const plan of view.plans) {
    lines.push(`plan: ${plan.id}`, `status: ${plan.status}`, `lease: ${plan.lease}`);
  }
  lines.push(`integration-merge-lease: ${view.integrationMergeLease}`);
  return { exitCode: 0, stdout: `${lines.join('\n')}\n`, stderr: '' };
}

function workflowFailure(error: unknown): CliResult {
  const message = error instanceof Error ? error.message : '';
  const code = error instanceof ApplicationCommandError
    ? error.code
    : message.startsWith('Unsupported future workflow schema version:')
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

async function readWorkflowFromPath(filePath: string): Promise<WorkflowSnapshot | null> {
  const absolute = isAbsolute(filePath) ? filePath : resolve(filePath);
  const extension = extname(absolute);
  if (extension.toLowerCase() !== '.json') {
    throw new TypeError('Workflow artifact must be a JSON file');
  }
  if (basename(dirname(absolute)).toLowerCase() === 'workflows') {
    return createFileHarnessApplication(fileInputFromWorkflowPath(absolute)).readWorkflow();
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'harness-cli-'));
  try {
    const temporaryWorkflows = join(temporaryRoot, 'workflows');
    await mkdir(temporaryWorkflows);
    await copyFile(absolute, join(temporaryWorkflows, `${basename(absolute, extension)}.json`));
    return await createFileHarnessApplication({
      artifactRoot: temporaryRoot,
      workflowId: basename(absolute, extension),
      actorId: 'Unknown',
      inputDigest: `file:${absolute}`,
    }).readWorkflow();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function statusWorkflow(filePath: string): Promise<CliResult> {
  try {
    const snapshot = await readWorkflowFromPath(filePath);
    if (snapshot === null) {
      return {
        exitCode: 1,
        stdout: `${failureBlock('status', 'workflow.artifact.missing', 'provide an existing workflow artifact')}\n`,
        stderr: '',
      };
    }
    return renderStatus({
      workflowId: snapshot.workflowId,
      revision: snapshot.revision,
      plans: snapshot.plans.map((plan) => ({ id: plan.id, status: plan.status, lease: plan.executionLease === undefined ? 'none' : 'execution' })),
      integrationMergeLease: snapshot.integrationMergeLease === undefined ? 'none' : 'integration-merge',
    });
  } catch (error) {
    return workflowFailure(error);
  }
}

async function readJsonPayload(filePath: string): Promise<JsonRecord> {
  const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  if (!isJsonRecord(parsed) || !isJsonRecord(parsed.fileInput)) {
    throw new ApplicationCommandError('cli.file-input.missing', 'JSON command payload requires fileInput');
  }
  return parsed;
}

function commandPayload(payload: JsonRecord): unknown {
  return Object.hasOwn(payload, 'command') ? payload.command : payload;
}

async function runApplicationCommand(command: string, filePath: string): Promise<CliResult> {
  try {
    const payload = await readJsonPayload(filePath);
    const app = createFileHarnessApplication(payload.fileInput as unknown as FileInput);
    const input = commandPayload(payload);
    const result = command === 'create'
      ? await app.createWorkflow(input as never)
      : command === 'read'
        ? await app.readWorkflow()
        : command === 'register-plan'
          ? await app.registerPlan(input as never)
          : command === 'register-assignment'
            ? await app.registerAssignment(input as never)
            : command === 'transition-plan'
              ? await app.transitionPlan(input as never)
              : command === 'claim-lease'
                ? await app.claimExecutionLease(input as never)
                : command === 'release-lease'
                  ? await app.releaseExecutionLease(input as never)
                  : command === 'append-completion-evidence'
                    ? await app.appendCompletionEvidence(input as never)
                    : undefined;
    if (result === undefined) {
      return { exitCode: 2, stdout: '', stderr: `${usage()}\n` };
    }
    return { exitCode: 0, stdout: `${JSON.stringify(result, null, 2)}\n`, stderr: '' };
  } catch (error) {
    const code = error instanceof ApplicationCommandError ? error.code : 'cli.command.failed';
    return { exitCode: 1, stdout: `${failureBlock(command, code, 'provide a valid application command payload')}\n`, stderr: '' };
  }
}

export async function runCli(args: readonly string[]): Promise<CliResult> {
  const command = args[0];
  const filePath = args[1];
  if (args.length !== 2 || command === undefined || filePath === undefined || filePath.trim().length === 0) {
    return { exitCode: 2, stdout: '', stderr: `${usage()}\n` };
  }

  if (command === 'validate') return validateAssignment(filePath);
  if (command === 'status') return statusWorkflow(filePath);
  if (!['create', 'read', 'register-plan', 'register-assignment', 'transition-plan', 'claim-lease', 'release-lease', 'append-completion-evidence'].includes(command)) {
    return { exitCode: 2, stdout: '', stderr: `${usage()}\n` };
  }
  return runApplicationCommand(command, filePath);
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
