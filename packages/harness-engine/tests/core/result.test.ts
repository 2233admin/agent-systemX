import { describe, expect, test } from 'bun:test';

import {
  isGateResult,
  isKnown,
  isUnknown,
  known,
  unknown,
  validateEvidenceRef,
  validateGateResult,
} from '../../src/core/result';
import { validateArtifactRevision, validateStableIdentity } from '../../src/core/ids';
import type { EvidenceRef, GateResult, Known, Unknown } from '../../src/core/result';

const observedAt = '2026-08-27T12:00:00.000Z';
const evidence: EvidenceRef = {
  source: 'unit-test',
  observedAt,
  locator: 'result.test.ts:1',
};

describe('core result contracts', () => {
  test('Known and Unknown retain their discriminants and payloads', () => {
    const resolved: Known<string> = known('ready', evidence);
    const unresolved: Unknown = unknown('not-observable', observedAt, 'retry after the host is available');

    expect(resolved).toEqual({ kind: 'known', value: 'ready', evidence });
    expect(unresolved).toEqual({
      kind: 'unknown',
      reasonCode: 'not-observable',
      observedAt,
      recovery: 'retry after the host is available',
    });
    expect(isKnown(resolved)).toBe(true);
    expect(isUnknown(unresolved)).toBe(true);
  });

  test('gate results accept pass/fail/blocked/unknown and reject other kinds', () => {
    const pass: GateResult<string> = { kind: 'pass', value: 'ready', evidence: [evidence] };
    const failure: GateResult<string> = {
      kind: 'fail',
      violations: [{ code: 'result.invalid' }],
      recovery: [{ code: 'result.retry', description: 'collect the missing evidence' }],
    };

    expect(isGateResult(pass)).toBe(true);
    expect(isGateResult(failure)).toBe(true);
    expect(isGateResult({ kind: 'blocked', violations: [], recovery: [] })).toBe(true);
    expect(isGateResult({ kind: 'unknown', violations: [], recovery: [] })).toBe(true);
    expect(isGateResult({ kind: 'success' })).toBe(false);
    expect(() => validateGateResult({ kind: 'fail', violations: [{ code: '   ' }], recovery: [] })).toThrow();
  });

  test('evidence contains source and an RFC 3339 observedAt timestamp', () => {
    expect(validateEvidenceRef(evidence)).toEqual(evidence);
    expect(() => validateEvidenceRef({ source: 'unit-test', observedAt: 'not-a-timestamp' })).toThrow();
    expect(() => validateEvidenceRef({ source: 'unit-test', observedAt: '2026-02-30T12:00:00Z' })).toThrow();
  });

  test('empty stable identity fields are rejected', () => {
    expect(() => validateStableIdentity({ workflowId: '', planId: 'plan-1' })).toThrow();
    expect(() => validateStableIdentity({ workflowId: 'workflow-1', planId: '  ' })).toThrow();
    expect(validateStableIdentity({ workflowId: 'workflow-1', planId: 'plan-1', taskId: 'task-1' })).toEqual({
      workflowId: 'workflow-1',
      planId: 'plan-1',
      taskId: 'task-1',
    });
  });

  test('artifact revisions carry numeric versions and an RFC 3339 updatedAt', () => {
    expect(
      validateArtifactRevision({ schemaVersion: 0, revision: 0, updatedAt: observedAt }),
    ).toEqual({ schemaVersion: 0, revision: 0, updatedAt: observedAt });
    expect(() => validateArtifactRevision({ schemaVersion: 1, revision: 1, updatedAt: 'yesterday' })).toThrow();
  });
});
