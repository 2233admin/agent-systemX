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

describe('JsonArtifactStore', () => {
  test('reads a missing workflow as null', async () => {
    const { store } = await makeStore();
    expect(await store.readWorkflow('missing')).toBeNull();
    expect(await store.readWorkflow('missing')).toBeNull();
  });

  test('writes and reads an explicit versioned workflow DTO', async () => {
    const { root, store } = await makeStore();
    await store.writeWorkflow(0, snapshot());

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

  test('rejects a revision mismatch without replacing the existing artifact', async () => {
    const { root, store } = await makeStore();
    await store.writeWorkflow(0, snapshot(1));
    const before = await readFile(join(root, 'workflows', 'workflow-1.json'), 'utf8');

    await expect(store.writeWorkflow(0, snapshot(2))).rejects.toThrow('revision');
    expect(await readFile(join(root, 'workflows', 'workflow-1.json'), 'utf8')).toBe(before);
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
    await store.writeWorkflow(0, snapshot());
    await store.writeWorkflow(1, { ...snapshot(2), plans: [] });

    const files = await readdir(join(root, 'workflows'));
    expect(files).toEqual(['workflow-1.json']);
    expect(await store.readWorkflow('workflow-1')).toMatchObject({ revision: 2, plans: [] });
  });
});
