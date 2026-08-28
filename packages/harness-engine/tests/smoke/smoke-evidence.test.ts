import { describe, expect, test } from 'bun:test';
import {
  collectRealSmokeEvidence,
  normalizeWindowsPath,
  runReadOnlyProcess,
  validateRealSmokeEvidence,
} from '../../src/smoke/evidence.ts';

const correlation = {
  workflowId: 'workflow-1', planId: 'plan-1', operationId: 'smoke-1', snapshotId: 'snapshot-1', attemptId: 'attempt-1',
  source: 'local-preflight', sourceVersion: '1', observedAt: '2026-08-28T00:00:00.000Z',
};

describe('Stage 4 real smoke evidence', () => {
  test('returns not-available without invoking a transport when prerequisites are missing', async () => {
    let invoked = false;
    const evidence = await collectRealSmokeEvidence({
      backend: 'orca',
      adapterVersion: 'controlled-only',
      correlation,
      requiredEnv: ['HARNESS_ORCA_RUN_ID'],
      environment: {},
      read: async () => {
        invoked = true;
        return { objectRefs: [], permission: 'read-only' as const, network: 'unknown' as const, readbackRefs: [], result: 'not-available' as const };
      },
    });
    expect(invoked).toBe(false);
    expect(evidence.result).toBe('not-available');
    expect(evidence.permission).toBe('read-only');
    expect(evidence.scope).toBe('read-only');
    expect(evidence.missing).toEqual(['HARNESS_ORCA_RUN_ID']);
  });

  test('rejects non-read-only or sensitive evidence', () => {
    const valid = {
      backend: 'github', adapterVersion: '1', observedAt: correlation.observedAt,
      objectRefs: ['owner/repo#1'], permission: 'read-only', network: 'unknown', readbackRefs: ['fixture://summary'],
      result: 'not-available', scope: 'read-only', currentHead: 'head', sourceHash: 'source', correlation,
      missing: ['HARNESS_GITHUB_OWNER'],
    } as const;
    expect(validateRealSmokeEvidence(valid)).toEqual(valid);
    expect(() => validateRealSmokeEvidence({ ...valid, scope: 'write' })).toThrow('read-only');
    expect(() => validateRealSmokeEvidence({ ...valid, readbackRefs: ['stderr: password=secret'] })).toThrow('sensitive');
  });

  test('normalizes Windows paths without shell semantics', () => {
    expect(normalizeWindowsPath('C:\\work tree\\测试\\artifact.json')).toBe('C:/work tree/测试/artifact.json');
    expect(() => normalizeWindowsPath('C:\\work\\..\\..\\secret')).toThrow('escape');
  });

  test('forces read-only environment and redacts sensitive stderr on non-zero exit', async () => {
    const result = await runReadOnlyProcess([
      process.execPath,
      '-e',
      'console.log(process.env.HARNESS_REAL_WRITE); console.error("password=secret"); process.exit(3)',
    ]);
    expect(result.exitCode).toBe(3);
    expect(result.stdoutSummary.trim()).toBe('0');
    expect(result.stderrSummary).toBe('[redacted]');
  });

  test('terminates a timed-out process without a shell command string', async () => {
    const result = await runReadOnlyProcess([process.execPath, '-e', 'setTimeout(() => {}, 1000)'], { timeoutMs: 10 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  });
});
