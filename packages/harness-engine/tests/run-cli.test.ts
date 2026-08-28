import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli, type RunCliDependencies } from '../src/cli/index.ts';
import type { OrcaExecutionPort } from '../src/ports/orca-execution.ts';
import type { ControlPlaneFacade } from '../src/application/control-plane-port.ts';

const temporaryDirectories: string[] = [];
const observedAt = '2026-08-29T00:00:00.000Z';
const baseSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const headSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixtureAssignment(value: Record<string, unknown>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'harness-run-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'assignment.json');
  await writeFile(path, JSON.stringify(value), 'utf8');
  return path;
}

function controlPlane(): ControlPlaneFacade {
  return {
    readConfigRevision: async () => ({ revisionId: 'rev-1', schemaVersion: 1, clientId: 'omp', source: 'fixture', sourceVersion: '1', observedAt }),
    readAssemblyManifest: async () => ({ revisionId: 'rev-1', clientId: 'omp', manifestDigest: 'manifest-1', itemCount: 1, source: 'fixture', sourceVersion: '1', observedAt }),
    probeClient: async () => ({ clientId: 'omp', clientVersion: '1.0.0', status: 'supported', source: 'fixture', sourceVersion: '1', observedAt }),
    prepareLaunch: async () => ({ revisionId: 'rev-1', clientId: 'omp', planDigest: 'plan-1', launchBoundary: 'invocation-scoped', source: 'fixture', sourceVersion: '1', observedAt }),
  };
}

function orca(status = 'done', branch?: string): OrcaExecutionPort {
  return {
    async runWorker() {
      return {
        kind: 'known',
        value: {
          runId: 'run-1', taskId: 'task-1', dispatchId: 'dispatch-1', workerId: 'worker-1', deliveryId: 'delivery-1',
          status, ...(branch === undefined ? {} : { branch }), worktreePath: 'D:/worker/worktree', command: ['orca', 'orchestration', 'worker-start', '--agent', 'omp'],
        },
        evidence: { source: 'orca.real', observedAt, locator: 'dispatch-1' },
      };
    },
  };
}

const process: RunCliDependencies['process'] = {
  async run(command, args) {
    if (command === 'git' && args[0] === 'rev-parse' && args[2] === assignment.baseSha) return { exitCode: 0, stdout: `${baseSha}\n`, stderr: '' };
    if (command === 'git' && args[0] === 'rev-parse') return { exitCode: 0, stdout: `${headSha}\n`, stderr: '' };
    if (command === 'git' && args[0] === 'diff') return { exitCode: 0, stdout: 'M\tsrc/example.ts\n', stderr: '' };
    if (command === 'bun') return { exitCode: 0, stdout: '1 pass\n', stderr: '' };
    throw new Error(`unexpected command ${command}`);
  },
};

const assignment = {
  schemaVersion: 1, workflowId: 'workflow-1', planId: 'plan-1', taskId: 'task-1', objective: 'Run the approved worker slice',
  worktreePath: 'D:/worker/worktree', branch: 'feature/run-slice', baseSha, revisionId: 'rev-1', client: 'omp', runId: 'run-1',
  testCommand: ['bun', 'test', 'tests/example.test.ts'],
};

describe('harness run', () => {
  test('runs an OMP assignment and returns worker, diff, test, and human summary', async () => {
    const path = await fixtureAssignment(assignment);
    const result = await runCli(['run', path, '--json'], { controlPlane: controlPlane(), orca: orca('done', 'feature/run-slice'), process });
    const payload = JSON.parse(result.stdout) as Record<string, any>;

    expect(result.exitCode).toBe(0);
    expect(payload.status).toBe('pass');
    expect(payload.summary).toContain('completed');
    expect(payload.identity).toMatchObject({ workflowId: 'workflow-1', planId: 'plan-1', taskId: 'task-1', runId: 'run-1' });
    expect(payload.orca.dispatchId).toBe('dispatch-1');
    expect(payload.worktree).toMatchObject({ base: baseSha, head: headSha, reviewRange: `${baseSha}..${headSha}` });
    expect(payload.diff.files).toEqual(['src/example.ts']);
    expect(payload.tests.status).toBe('passed');
    expect(payload.orca.command).toEqual(['orca', 'orchestration', 'worker-start', '--agent', 'omp']);
    expect(payload.violations).toEqual([]);
  });

  test('continues execution when OMP native config control is known unsupported', async () => {
    const path = await fixtureAssignment(assignment);
    const degradedControlPlane: ControlPlaneFacade = {
      ...controlPlane(),
      probeClient: async () => ({
        clientId: 'omp',
        clientVersion: '18.0.10',
        status: 'unsupported',
        reasonCode: 'omp-native-interface-has-no-agent-system-config-concept',
        source: 'fixture',
        sourceVersion: '1',
        observedAt,
      }),
    };
    const result = await runCli(['run', path, '--json'], { controlPlane: degradedControlPlane, orca: orca('done', 'feature/run-slice'), process });
    const payload = JSON.parse(result.stdout) as Record<string, any>;

    expect(result.exitCode).toBe(0);
    expect(payload.status).toBe('pass');
    expect(payload.capability.status).toBe('unsupported');
    expect(payload.capability.reasonCode).toBe('omp-native-interface-has-no-agent-system-config-concept');
    expect(payload.violations).toEqual([]);
  });

  test('does not persist a misleading Todo workflow artifact after a run', async () => {
    const path = await fixtureAssignment(assignment);
    const result = await runCli(['run', path, '--json'], { controlPlane: controlPlane(), orca: orca('done', 'feature/run-slice'), process });
    expect(result.exitCode).toBe(0);
    await expect(Bun.file(join(path, '..', 'workflows', 'workflow-1.json')).exists()).resolves.toBe(false);
  });

  test('returns not-available when Orca cannot start the worker', async () => {
    const path = await fixtureAssignment(assignment);
    const unavailable: OrcaExecutionPort = { async runWorker() { return { kind: 'unknown', reasonCode: 'orca.cli.unavailable', observedAt, recovery: 'start Orca and retry' }; } };
    const result = await runCli(['run', path, '--json'], { controlPlane: controlPlane(), orca: unavailable, process });
    const payload = JSON.parse(result.stdout) as Record<string, any>;
    expect(result.exitCode).toBe(1);
    expect(payload.status).toBe('not-available');
    expect(payload.orca).toBeUndefined();
  });

  test('reports a known worker failure as fail, not blocked', async () => {
    const path = await fixtureAssignment(assignment);
    const result = await runCli(['run', path, '--json'], { controlPlane: controlPlane(), orca: orca('cancelled', 'feature/run-slice'), process });
    const payload = JSON.parse(result.stdout) as Record<string, any>;
    expect(result.exitCode).toBe(1);
    expect(payload.status).toBe('fail');
    expect(payload.code).toBe('orca.worker.failed');
    expect(payload.orca.status).toBe('cancelled');
  });

  test('rejects missing worker branch evidence', async () => {
    const path = await fixtureAssignment(assignment);
    const result = await runCli(['run', path, '--json'], { controlPlane: controlPlane(), orca: orca(), process });
    const payload = JSON.parse(result.stdout) as Record<string, any>;
    expect(result.exitCode).toBe(1);
    expect(payload.status).toBe('blocked');
    expect(payload.code).toBe('orca.branch.missing');
  });

  test('rejects malformed assignment JSON as fail', async () => {
    const path = await fixtureAssignment(assignment);
    await writeFile(path, '{bad json', 'utf8');
    const result = await runCli(['run', path, '--json'], { controlPlane: controlPlane(), orca: orca(), process });
    const payload = JSON.parse(result.stdout) as Record<string, any>;
    expect(result.exitCode).toBe(1);
    expect(payload.status).toBe('fail');
    expect(payload.code).toBe('assignment.json.invalid');
  });
  test('does not invoke Orca when assignment JSON is malformed', async () => {
    const path = await fixtureAssignment(assignment);
    await writeFile(path, '{bad json', 'utf8');
    let calls = 0;
    const guardedOrca: OrcaExecutionPort = {
      async runWorker() {
        calls += 1;
        throw new Error('must not run');
      },
    };
    const result = await runCli(['run', path, '--json'], { controlPlane: controlPlane(), orca: guardedOrca, process });
    const payload = JSON.parse(result.stdout) as Record<string, any>;
    expect(result.exitCode).toBe(1);
    expect(payload).toMatchObject({ status: 'fail', code: 'assignment.json.invalid' });
    expect(calls).toBe(0);
  });

  test('rejects unsupported assignment schema as fail', async () => {
    const path = await fixtureAssignment({ ...assignment, schemaVersion: 99 });
    const result = await runCli(['run', path, '--json'], { controlPlane: controlPlane(), orca: orca(), process });
    const payload = JSON.parse(result.stdout) as Record<string, any>;
    expect(result.exitCode).toBe(1);
    expect(payload.status).toBe('fail');
    expect(payload.code).toBe('assignment.schema-version.unsupported');
  });

  test('returns explicit help for run --help and -h', async () => {
    await expect(runCli(['run', '--help'])).resolves.toMatchObject({ exitCode: 0, stdout: expect.stringContaining('harness run') });
    await expect(runCli(['run', '-h'])).resolves.toMatchObject({ exitCode: 0, stdout: expect.stringContaining('harness run') });
  });

  test('rejects incomplete assignment without invoking Orca', async () => {
    const path = await fixtureAssignment({ ...assignment, testCommand: undefined });
    let calls = 0;
    const guardedOrca: OrcaExecutionPort = { async runWorker() { calls += 1; throw new Error('must not run'); } };
    const result = await runCli(['run', path, '--json'], { controlPlane: controlPlane(), orca: guardedOrca, process });
    const payload = JSON.parse(result.stdout) as Record<string, any>;
    expect(result.exitCode).toBe(1);
    expect(payload.status).toBe('fail');
    expect(payload.code).toBe('assignment.test-command.missing');
    expect(calls).toBe(0);
  });

  test('does not promote accepted worker input to success', async () => {
    const path = await fixtureAssignment(assignment);
    const result = await runCli(['run', path, '--json'], { controlPlane: controlPlane(), orca: orca('accepted', 'feature/run-slice'), process });
    const payload = JSON.parse(result.stdout) as Record<string, any>;
    expect(result.exitCode).toBe(1);
    expect(payload.status).toBe('blocked');
    expect(payload.code).toBe('orca.worker.not-complete');
  });

  test('rejects abbreviated base SHA instead of treating it as concrete', async () => {
    const path = await fixtureAssignment({ ...assignment, baseSha: 'aaaaaaa' });
    const result = await runCli(['run', path, '--json'], { controlPlane: controlPlane(), orca: orca('done', 'feature/run-slice'), process });
    const payload = JSON.parse(result.stdout) as Record<string, any>;
    expect(result.exitCode).toBe(1);
    expect(payload.status).toBe('fail');
    expect(payload.code).toBe('assignment.base-sha.invalid');
  });
  test('renders a human summary by default and JSON only with --json', async () => {
    const path = await fixtureAssignment(assignment);
    const result = await runCli(['run', path], { controlPlane: controlPlane(), orca: orca('done', 'feature/run-slice'), process });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Harness run completed');
    expect(result.stdout).toContain('status: pass');
    expect(() => JSON.parse(result.stdout)).toThrow();
  });
});
