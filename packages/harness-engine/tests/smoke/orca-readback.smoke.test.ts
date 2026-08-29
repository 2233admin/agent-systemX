import { expect, test } from 'bun:test';
import { collectRealSmokeEvidence } from '../../src/smoke/evidence.ts';

test('Orca smoke remains not-available without natural object IDs', async () => {
  let called = false;
  const result = await collectRealSmokeEvidence({
    backend: 'orca',
    adapterVersion: 'stage4-readonly',
    correlation: { workflowId: 'unknown', planId: 'unknown', operationId: 'orca-smoke', snapshotId: 'unknown', attemptId: 'preflight', source: 'real-smoke.orca', sourceVersion: '1', observedAt: '2026-08-28T00:00:00.000Z' },
    requiredEnv: ['HARNESS_ORCA_RUN_ID', 'HARNESS_ORCA_TASK_ID', 'HARNESS_ORCA_DISPATCH_ID', 'HARNESS_ORCA_WORKER_ID', 'HARNESS_ORCA_DELIVERY_ID'],
    environment: {},
    read: async () => { called = true; return { objectRefs: [], permission: 'read-only' as const, network: 'unknown' as const, readbackRefs: [], result: 'pass' as const }; },
  });
  expect(called).toBe(false);
  expect(result.result).toBe('not-available');
});
