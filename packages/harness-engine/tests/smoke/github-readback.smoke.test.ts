import { expect, test } from 'bun:test';
import { collectRealSmokeEvidence } from '../../src/smoke/evidence.ts';

test('GitHub smoke remains not-available without natural PR identifiers', async () => {
  let called = false;
  const result = await collectRealSmokeEvidence({
    backend: 'github',
    adapterVersion: 'stage4-readonly',
    correlation: { workflowId: 'unknown', planId: 'unknown', operationId: 'github-smoke', snapshotId: 'unknown', attemptId: 'preflight', source: 'real-smoke.github', sourceVersion: '1', observedAt: '2026-08-28T00:00:00.000Z' },
    requiredEnv: ['HARNESS_GITHUB_OWNER', 'HARNESS_GITHUB_REPOSITORY', 'HARNESS_GITHUB_PR_NUMBER'],
    environment: {},
    read: async () => { called = true; return { objectRefs: [], permission: 'read-only' as const, network: 'unknown' as const, readbackRefs: [], result: 'pass' as const }; },
  });
  expect(called).toBe(false);
  expect(result.result).toBe('not-available');
});
