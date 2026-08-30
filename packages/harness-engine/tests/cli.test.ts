import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from '../src/cli/index.ts';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'harness-cli-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeAssignment(directory: string, content: string): Promise<string> {
  const path = join(directory, 'assignment.md');
  await writeFile(path, content, 'utf8');
  return path;
}

async function writeWorkflow(directory: string, value: unknown, id = 'workflow-1'): Promise<string> {
  const workflows = join(directory, 'workflows');
  await Bun.write(join(workflows, `${id}.json`), JSON.stringify(value));
  return join(workflows, `${id}.json`);
}

const validAssignment = `## Assignment
Execute as: worker
Delegation: local
Task category: implementation
Working branch: feature/cli
Execution mode: sdd
Task 7: do not print this dynamic task正文
`;

const observedAt = '2026-08-27T12:00:00.000Z';

function validValidationInput(assignment: string) {
  return {
    assignment,
    planId: 'plan-1',
    taskId: 'task-1',
    worktree: '/tmp/harness-cli',
    branchProtection: { defaultBranch: 'main', protectedBranches: ['main', 'master'] },
    hostCapability: {
      status: 'supported' as const,
      hostId: 'omp',
      hostVersion: '1.0.0',
      evidence: { source: 'cli-test', observedAt, hostId: 'omp', hostVersion: '1.0.0' },
    },
    leaseState: {
      kind: 'execution' as const,
      workflowId: 'workflow-1',
      planId: 'plan-1',
      holderId: 'worker',
      worktreePath: '/tmp/harness-cli',
      fencingToken: 1,
      claimedAt: observedAt,
    },
  };
}

const validWorkflow = {
  schemaVersion: 1,
  revision: 4,
  workflowId: 'workflow-1',
  plans: [{
    id: 'plan-1',
    title: 'Public plan title',
    status: 'InReview',
    metadata: {
      prompt: 'secret prompt',
      dynamicTask: 'private task正文',
      credential: 'top-secret',
      owner: 'team-a',
    },
  }],
  updatedAt: '2026-08-27T12:00:00.000Z',
};

describe('harness CLI', () => {
  test('validates a complete Assignment', async () => {
    const path = await writeAssignment(await fixtureDirectory(), JSON.stringify(validValidationInput(validAssignment)));
    const result = await runCli(['validate', path]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('status: pass');
    expect(result.stdout).not.toContain('dynamic task正文');
  });

  test('reports missing Assignment fields with stable violation codes', async () => {
    const path = await writeAssignment(await fixtureDirectory(), validAssignment.replace('Delegation: local\n', ''));
    const result = await runCli(['validate', path]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('assignment.field.missing-delegation');
    expect(result.stdout).toContain('phase: validate');
    expect(result.stdout).toContain('recovery:');
  });

  test('reports protected default branch failure', async () => {
    const assignment = validAssignment.replace('Working branch: feature/cli', 'Working branch: main');
    const path = await writeAssignment(await fixtureDirectory(), JSON.stringify(validValidationInput(assignment)));
    const result = await runCli(['validate', path]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('branch.protected-default');
  });

  test('reports malformed workflow JSON without throwing', async () => {
    const directory = await fixtureDirectory();
    const path = join(directory, 'workflows', 'workflow-1.json');
    await Bun.write(path, '{not-json');
    const result = await runCli(['status', path]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('workflow.artifact.malformed');
    expect(result.stdout).not.toContain('not-json');
  });

  test('reports a future workflow schema as a stable validation failure', async () => {
    const directory = await fixtureDirectory();
    const path = await writeWorkflow(directory, { ...validWorkflow, schemaVersion: 99 });
    const result = await runCli(['status', path]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('workflow.schema.future');
  });

  test('status output is limited to public workflow, plan, status, and lease summaries', async () => {
    const path = await writeWorkflow(await fixtureDirectory(), validWorkflow);
    const result = await runCli(['status', path]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('workflow: workflow-1');
    expect(result.stdout).toContain('plan: plan-1');
    expect(result.stdout).toContain('status: InReview');
    expect(result.stdout).not.toContain('secret prompt');
    expect(result.stdout).not.toContain('private task正文');
    expect(result.stdout).not.toContain('top-secret');
    expect(result.stdout).not.toContain('Public plan title');
  });

  test('rejects non-JSON paths without reading a sibling JSON artifact', async () => {
    const directory = await fixtureDirectory();
    const workflows = join(directory, 'workflows');
    const path = join(workflows, 'workflow.json.backup');
    const sibling = { ...validWorkflow, workflowId: 'workflow.json', revision: 22 };
    await Bun.write(path, JSON.stringify(validWorkflow));
    await Bun.write(join(workflows, 'workflow.json.json'), JSON.stringify(sibling));

    const result = await runCli(['status', path]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('workflow.artifact.malformed');
    expect(result.stdout).not.toContain('revision: 22');
  });

  test('renders each duplicate plan id from its own lease state', async () => {
    const directory = await fixtureDirectory();
    const leasedPlan = {
      id: 'plan-1',
      title: 'Private title',
      status: 'InProgress',
      metadata: {},
      executionLease: {
        kind: 'execution',
        workflowId: 'workflow-1',
        planId: 'plan-1',
        holderId: 'worker',
        worktreePath: '/tmp/worktree',
        fencingToken: 1,
        claimedAt: '2026-08-27T12:00:00.000Z',
      },
    };
    const path = await writeWorkflow(directory, {
      ...validWorkflow,
      plans: [{ id: 'plan-1', title: 'Private title', status: 'Todo', metadata: {} }, leasedPlan],
    });

    const result = await runCli(['status', path]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/plan: plan-1\nstatus: Todo\nlease: none\nplan: plan-1\nstatus: InProgress\nlease: execution/);
  });

  test('uses usage exit code for missing and unknown command arguments', async () => {
    await expect(runCli([])).resolves.toMatchObject({ exitCode: 2 });
    await expect(runCli(['validate'])).resolves.toMatchObject({ exitCode: 2 });
    await expect(runCli(['status', 'one.json', 'extra'])).resolves.toMatchObject({ exitCode: 2 });
    await expect(runCli(['unknown', 'one.json'])).resolves.toMatchObject({ exitCode: 2 });
  });
});
