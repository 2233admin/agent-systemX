import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonArtifactStore } from '../../src/adapters/json/json-artifact-store.ts';
import type { WorkflowSnapshot } from '../../src/domain/workflow.ts';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function snapshot(revision = 1): WorkflowSnapshot {
  return {
    schemaVersion: 1,
    revision,
    workflowId: 'workflow-1',
    plans: [
      {
        id: 'plan-1',
        title: 'Build the thing',
        status: 'InReview',
        metadata: {
          owner: 'team-a',
          prompt: 'do not persist this',
          transcript: 'private transcript',
          credential: 'secret',
          toolPayload: { token: 'private' },
          dynamicTask: { internal: true },
        },
      },
    ],
  };
}

async function makeStore(): Promise<{ root: string; store: JsonArtifactStore }> {
  const root = await mkdtemp(join(tmpdir(), 'harness-artifact-store-'));
  temporaryDirectories.push(root);
  return { root, store: new JsonArtifactStore(root) };
}

let seedCounter = 0;
async function seedWorkflow(store: JsonArtifactStore, expectedRevision: number, next: WorkflowSnapshot): Promise<void> {
  const id = `seed-${seedCounter += 1}`;
  const result = await store.writeWorkflowConditional({
    expectedRevision,
    next,
    operationId: id,
    idempotencyKey: id,
    inputDigest: id,
  });
  if (result.kind !== 'applied') {
    throw new Error(`${result.kind}: ${result.violations.map((violation) => violation.code).join(',')}`);
  }
}

describe('JsonArtifactStore', () => {
  test('reads a missing workflow as null', async () => {
    const { store } = await makeStore();
    expect(await store.readWorkflow('missing')).toBeNull();
    expect(await store.readWorkflow('missing')).toBeNull();
  });

  test('writes and reads an explicit versioned workflow DTO', async () => {
    const { root, store } = await makeStore();
    await seedWorkflow(store, 0, snapshot());

    const loaded = await store.readWorkflow('workflow-1');
    expect(loaded).toMatchObject({ schemaVersion: 1, revision: 1, workflowId: 'workflow-1' });
    expect(typeof loaded?.updatedAt).toBe('string');

    const raw = await readFile(join(root, 'workflows', 'workflow-1.json'), 'utf8');
    expect(raw).toContain('"schemaVersion": 1');
    for (const privateValue of ['do not persist this', 'private transcript', 'secret', 'private', 'internal']) {
      expect(raw).not.toContain(privateValue);
    }
    for (const privateKey of ['prompt', 'transcript', 'credential', 'toolPayload', 'dynamicTask']) {
      expect(raw).not.toContain(privateKey);
    }
  });
  test('filters full-width and format-inserted dynamic privacy keys', async () => {
    const { root, store } = await makeStore();
    const base = snapshot();
    const input: WorkflowSnapshot = {
      ...base,
      plans: [{ ...base.plans[0]!, metadata: { ...base.plans[0]!.metadata, 'ｔａｓｋ正文': 'full-width secret', 'task\u200b正文': 'format secret' } }],
    };
    await seedWorkflow(store, 0, input);
    const raw = await readFile(join(root, 'workflows', 'workflow-1.json'), 'utf8');
    expect(raw).not.toContain('full-width secret');
    expect(raw).not.toContain('format secret');
  });

  test('rejects a revision mismatch without replacing the existing artifact', async () => {
    const { root, store } = await makeStore();
    await seedWorkflow(store, 0, snapshot(1));
    const before = await readFile(join(root, 'workflows', 'workflow-1.json'), 'utf8');

    await expect(seedWorkflow(store, 0, snapshot(2))).rejects.toThrow('revision');
    expect(await readFile(join(root, 'workflows', 'workflow-1.json'), 'utf8')).toBe(before);
  });

  test('allows only one concurrent writer for the same expected revision', async () => {
    const { store } = await makeStore();
    const results = await Promise.allSettled([
      seedWorkflow(store, 0, snapshot(1)),
      seedWorkflow(store, 0, { ...snapshot(1), plans: [] }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await store.readWorkflow('workflow-1')).toMatchObject({ revision: 1 });
  });


  test('recovers a lock only after proving its owner exited', async () => {
    const { root, store } = await makeStore();
    const lockPath = join(root, 'workflows', 'workflow-1.json.lock');
    const child = Bun.spawn([process.execPath, '-e', 'process.exit(0)']);
    await child.exited;
    await Bun.write(lockPath, JSON.stringify({
      ownerPid: child.pid,
      ownerToken: 'exited-owner',
      createdAt: new Date().toISOString(),
    }));

    await seedWorkflow(store, 0, snapshot(1));
    expect(await store.readWorkflow('workflow-1')).toMatchObject({ revision: 1 });
    expect(await readdir(join(root, 'workflows'))).toEqual(['workflow-1.json']);
  });

  test('keeps active or unverifiable locks blocked', async () => {
    const { root, store } = await makeStore();
    const lockPath = join(root, 'workflows', 'workflow-1.json.lock');
    await Bun.write(lockPath, JSON.stringify({
      ownerPid: process.pid,
      ownerToken: 'active-owner',
      createdAt: new Date().toISOString(),
    }));
    await expect(seedWorkflow(store, 0, snapshot(1))).rejects.toThrow('lock');

    await Bun.write(lockPath, JSON.stringify({ ownerPid: 'unknown' }));
    await expect(seedWorkflow(store, 0, snapshot(1))).rejects.toThrow('lock');

    const child = Bun.spawn([process.execPath, '-e', 'process.exit(0)']);
    await child.exited;
    await Bun.write(lockPath, JSON.stringify({
      ownerPid: child.pid,
      ownerToken: '',
      createdAt: new Date().toISOString(),
    }));
    await expect(seedWorkflow(store, 0, snapshot(1))).rejects.toThrow('lock');

    await Bun.write(lockPath, JSON.stringify({
      ownerPid: child.pid,
      ownerToken: 'malformed-time',
      createdAt: 'not-a-timestamp',
    }));
    await expect(seedWorkflow(store, 0, snapshot(1))).rejects.toThrow('lock');
  });
  test('rejects malformed execution and integration merge leases', async () => {
    const { root, store } = await makeStore();
    const directory = join(root, 'workflows');
    await Bun.write(join(directory, 'workflow-1.json'), JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      workflowId: 'workflow-1',
      plans: [{
        id: 'plan-1',
        title: 'Build the thing',
        status: 'Todo',
        metadata: {},
        executionLease: { holder: 42 },
      }],
      updatedAt: new Date().toISOString(),
    }));
    await expect(store.readWorkflow('workflow-1')).rejects.toThrow('lease');
    await Bun.write(join(directory, 'workflow-1.json'), JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      workflowId: 'workflow-1',
      plans: [{
        id: 'plan-1',
        title: 'Build the thing',
        status: 'Todo',
        metadata: {},
        executionLease: {
          kind: 'execution',
          workflowId: 'workflow-1',
          planId: 'plan-1',
          holderId: 'worker-1',
          worktreePath: 'D:/worktrees/plan-1',
          fencingToken: 'invalid',
          claimedAt: '2026-08-27T12:00:00.000Z',
        },
      }],
      updatedAt: new Date().toISOString(),
    }));
    await expect(store.readWorkflow('workflow-1')).rejects.toThrow('lease');


    await Bun.write(join(directory, 'workflow-1.json'), JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      workflowId: 'workflow-1',
      plans: [],
      integrationMergeLease: { expiresAt: [] },
      updatedAt: new Date().toISOString(),
    }));
    await expect(store.readWorkflow('workflow-1')).rejects.toThrow('lease');
  });


  test('rejects future schema versions instead of migrating them', async () => {
    const { root, store } = await makeStore();
    const directory = join(root, 'workflows');
    await Bun.write(join(directory, 'workflow-1.json'), JSON.stringify({
      schemaVersion: 2,
      revision: 1,
      workflowId: 'workflow-1',
      plans: [],
      updatedAt: new Date().toISOString(),
    }));

    await expect(store.readWorkflow('workflow-1')).rejects.toThrow('schema');
  });

  test('replaces artifacts atomically in the same directory', async () => {
    const { root, store } = await makeStore();
    await seedWorkflow(store, 0, snapshot());
    await seedWorkflow(store, 1, { ...snapshot(2), plans: [] });

    const files = await readdir(join(root, 'workflows'));
    expect(files).toEqual(['workflow-1.json']);
    expect(await store.readWorkflow('workflow-1')).toMatchObject({ revision: 2, plans: [] });
  });
});
