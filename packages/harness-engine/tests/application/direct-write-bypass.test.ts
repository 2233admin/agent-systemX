import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as publicIndex from '../../src/index.ts';
import * as adapterModule from '../../src/adapters/json/json-artifact-store.ts';
import { createJsonArtifactStore } from '../../src/adapters/json/json-artifact-store.ts';
import type { ApplicationWriteAuthorization } from '../../src/ports/artifacts.ts';
import type { WorkflowSnapshot } from '../../src/domain/workflow.ts';

const temporaryDirectories: string[] = [];

const authorization: ApplicationWriteAuthorization = {
  kind: 'harness-application-write',
  applicationId: 'workflow-1:worker-1:sha256:input',
  nonce: 'nonce-1',
};

function snapshot(revision = 1): WorkflowSnapshot {
  return {
    schemaVersion: 1,
    revision,
    workflowId: 'workflow-1',
    plans: [{ id: 'plan-1', title: 'Build the thing', status: 'Todo', metadata: {} }],
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'harness-direct-write-'));
  temporaryDirectories.push(root);
  return root;
}

async function artifactContents(root: string): Promise<string | null> {
  try {
    return await readFile(join(root, 'workflows', 'workflow-1.json'), 'utf8');
  } catch {
    return null;
  }
}

describe('ArtifactStore direct write bypass prevention', () => {
  test('does not export the raw JsonArtifactStore constructor from public or adapter modules', () => {
    expect('JsonArtifactStore' in publicIndex).toBe(false);
    expect('JsonArtifactStore' in adapterModule).toBe(false);
  });

  test('rejects missing or wrong application write authorization without creating artifacts', async () => {
    const root = await fixtureRoot();
    const store = createJsonArtifactStore(root, authorization);

    await expect((store as { writeWorkflow(expectedRevision: number, next: WorkflowSnapshot): Promise<void> })
      .writeWorkflow(0, snapshot())).rejects.toThrow('authorization');
    expect(await artifactContents(root)).toBeNull();

    await expect(store.writeWorkflow(0, snapshot(), { ...authorization, nonce: 'wrong' }))
      .rejects.toThrow('authorization');
    expect(await artifactContents(root)).toBeNull();
  });

  test('rejects stale revisions and malformed leases without replacing the artifact', async () => {
    const root = await fixtureRoot();
    const store = createJsonArtifactStore(root, authorization);
    await store.writeWorkflow(0, snapshot(1), authorization);
    const before = await artifactContents(root);

    await expect(store.writeWorkflow(0, snapshot(2), authorization)).rejects.toThrow('revision');
    expect(await artifactContents(root)).toBe(before);

    await expect(store.writeWorkflow(1, {
      ...snapshot(2),
      plans: [{
        id: 'plan-1',
        title: 'Build the thing',
        status: 'InProgress',
        metadata: {},
        executionLease: { holder: 'not-canonical' } as never,
      }],
    }, authorization)).rejects.toThrow('lease');
    expect(await artifactContents(root)).toBe(before);
  });
});
