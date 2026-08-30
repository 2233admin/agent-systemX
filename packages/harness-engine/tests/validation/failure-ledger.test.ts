import { describe, expect, test } from 'bun:test';

import { isFailureLedger, validateFailureLedger, type FailureRow } from '../../src/validation/failure-ledger.ts';

const rerunResult = { exitCode: 1, outcome: 'failed' };
const closureEvidence = { source: 'baseline-test', observedAt: '2026-08-28T00:00:00Z' };

function row(overrides: Partial<FailureRow> = {}): FailureRow {
  return {
    id: 'failure-1',
    status: 'current',
    owner: 'harness-stage0',
    rerunCommand: 'bun test failure-ledger.test.ts',
    rerunResult,
    closureEvidence,
    ...overrides,
  };
}

describe('validateFailureLedger', () => {
  test('accepts the exact zero-failures empty tuple shape', () => {
    const ledger = validateFailureLedger([]);
    expect(ledger).toEqual([]);
    expect(isFailureLedger(ledger)).toBe(true);
  });

  test('accepts a current row with a populated rerun result', () => {
    expect(validateFailureLedger([row({ closureEvidence: '' })])).toHaveLength(1);
  });

  test('accepts a current row with populated closure evidence', () => {
    expect(validateFailureLedger([row({ rerunResult: null })])).toHaveLength(1);
  });

  test('rejects missing or empty closure fields when neither field is populated', () => {
    expect(() => validateFailureLedger([row({ rerunResult: undefined, closureEvidence: undefined })])).toThrow();
    expect(() => validateFailureLedger([row({ rerunResult: '', closureEvidence: [] })])).toThrow();
    const { closureEvidence: _closureEvidence, ...missingClosureEvidence } = row();
    expect(() => validateFailureLedger([missingClosureEvidence])).toThrow();
  });

  test('rejects a missing owner', () => {
    expect(() => validateFailureLedger([row({ owner: '' })])).toThrow();
    const { owner: _owner, ...missingOwner } = row();
    expect(() => validateFailureLedger([missingOwner])).toThrow();
  });

  test('rejects a stale-only ledger', () => {
    expect(() => validateFailureLedger([row({ status: 'stale' })])).toThrow();
  });

  test('rejects duplicate failure ids', () => {
    expect(() => validateFailureLedger([row(), row({ id: 'failure-1' })])).toThrow();
  });
});
