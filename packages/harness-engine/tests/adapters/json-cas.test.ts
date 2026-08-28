import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonArtifactStore } from '../../src/adapters/json/json-artifact-store.ts';
import type { WorkflowSnapshot } from '../../src/domain/workflow.ts';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function snapshot(revision: number, title = 'Plan'): WorkflowSnapshot {
  return {
    schemaVersion: 1,
    revision,
    workflowId: 'workflow-1',
    plans: [{ id: 'plan-1', title, status: 'Todo', metadata: {} }],
    updatedAt: '2026-08-28T00:00:00.000Z',
  };
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'harness-cas-'));
  temporaryDirectories.push(root);
  return root;
}

async function makeStore(): Promise<JsonArtifactStore> {
  return new JsonArtifactStore(await makeRoot());
}

describe('JsonArtifactStore conditional writes', () => {
  test('returns an applied result for a matching CAS write', async () => {
    const store = await makeStore();
    const result = await store.writeWorkflowConditional({
      expectedRevision: 0,
      next: snapshot(1),
      operationId: 'op-1',
      idempotencyKey: 'key-1',
      inputDigest: 'digest-1',
    });
    expect(result.kind).toBe('applied');
    expect(result.revision).toBe(1);
  });

  test('returns a structured conflict without replacing the artifact', async () => {
    const store = await makeStore();
    await store.writeWorkflow(0, snapshot(1, 'Original'));
    const result = await store.writeWorkflowConditional({
      expectedRevision: 0,
      next: snapshot(1, 'Stale'),
      operationId: 'op-2',
      idempotencyKey: 'key-2',
      inputDigest: 'digest-2',
    });
    expect(result.kind).toBe('conflict');
    expect(await store.readWorkflow('workflow-1')).toMatchObject({ revision: 1, plans: [{ title: 'Original' }] });
  });

  test('returns the original result for an idempotent repeat and rejects digest reuse', async () => {
    const store = await makeStore();
    const request = {
      expectedRevision: 0,
      next: snapshot(1),
      operationId: 'op-3',
      idempotencyKey: 'key-3',
      inputDigest: 'digest-3',
    } as const;
    const first = await store.writeWorkflowConditional(request);
    const repeat = await store.writeWorkflowConditional(request);
    const changed = await store.writeWorkflowConditional({ ...request, inputDigest: 'digest-other' });
    expect(repeat).toEqual(first);
    expect(changed.kind).toBe('rejected');
    expect(await store.readWorkflow('workflow-1')).toMatchObject({ revision: 1 });
  });
  test('persists a canonical envelope and replays idempotency after reopening', async () => {
    const root = await makeRoot();
    const store = new JsonArtifactStore(root);
    const request = {
      expectedRevision: 0,
      next: snapshot(1),
      operationId: 'op-restart',
      idempotencyKey: 'key-restart',
      inputDigest: 'digest-restart',
    } as const;
    const first = await store.writeWorkflowConditional(request);
    const raw = JSON.parse(await readFile(join(root, 'workflows', 'workflow-1.json'), 'utf8')) as Record<string, unknown>;
    expect(raw.artifactKind).toBe('workflow');
    expect(raw.value).toMatchObject({ plans: [{ id: 'plan-1' }] });
    const reopened = new JsonArtifactStore(root);
    const replay = await reopened.writeWorkflowConditional(request);
    expect(replay).toEqual(first);
    const changed = await reopened.writeWorkflowConditional({ ...request, inputDigest: 'different-digest' });
    expect(changed.kind).toBe('rejected');
    expect(await reopened.readWorkflow('workflow-1')).toMatchObject({ revision: 1 });
  });

  test('rejects tampered and future canonical envelopes', async () => {
    const root = await makeRoot();
    const store = new JsonArtifactStore(root);
    await store.writeWorkflow(0, snapshot(1));
    const path = join(root, 'workflows', 'workflow-1.json');
    const envelope = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    const value = envelope.value as Record<string, unknown>;
    await writeFile(path, JSON.stringify({ ...envelope, value: { ...value, plans: [] } }));
    await expect(store.readWorkflow('workflow-1')).rejects.toThrow('canonical hash');
    const future = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    await writeFile(path, JSON.stringify({ ...future, schemaVersion: 99 }));
    await expect(store.readWorkflow('workflow-1')).rejects.toThrow('future');
  });
});
