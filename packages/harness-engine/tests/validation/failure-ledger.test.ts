import { describe, expect, test } from 'bun:test';

import {
  isFailureLedger,
  validateFailureLedger,
  type FailureLedgerRow,
  type RerunResult,
} from '../../src/validation/failure-ledger.ts';

const rerunResult: RerunResult = {
  suiteCommand: 'bun test packages/harness-engine/tests/validation/failure-ledger.test.ts',
  exitCode: 1,
  firstError: 'expected failure',
  observedAt: '2026-08-28T00:00:00Z',
};

function row(overrides: Partial<FailureLedgerRow> = {}): FailureLedgerRow {
  return {
    id: 'failure-1',
    suiteCommand: 'bun test packages/harness-engine/tests/validation/failure-ledger.test.ts',
    suiteExitCode: 1,
    firstError: 'expected failure',
    contractRef: 'harness-stage0@1',
    owner: 'harness-stage0',
    rerunCommand: 'bun test packages/harness-engine/tests/validation/failure-ledger.test.ts',
    rerunResult,
    closureEvidence: ['baseline-test'],
    ...overrides,
  };
}

function currentLedger(failures: FailureLedgerRow[] = [row()]) {
  return { status: 'current-failures' as const, failures };
}

describe('validateFailureLedger', () => {
  test('rejects a bare empty array', () => {
    expect(() => validateFailureLedger([])).toThrow();
    expect(isFailureLedger([])).toBe(false);
  });

  test('accepts the tagged zero-failures shape', () => {
    const ledger = validateFailureLedger({ status: 'zero-failures', failures: [] });
    expect(ledger).toEqual({ status: 'zero-failures', failures: [] });
    expect(isFailureLedger(ledger)).toBe(true);
  });

  test('accepts a tagged current-failures row with a populated rerun result', () => {
    expect(validateFailureLedger(currentLedger([row({ closureEvidence: [] })]))).toMatchObject({
      status: 'current-failures',
    });
  });

  test('accepts a rerun result when firstError is omitted', () => {
    const { firstError: _firstError, ...rerunWithoutFirstError } = rerunResult;
    expect(
      validateFailureLedger(
        currentLedger([row({ closureEvidence: [], rerunResult: rerunWithoutFirstError })]),
      ),
    ).toMatchObject({ status: 'current-failures' });
  });

  test('accepts a tagged current-failures row with populated closure evidence', () => {
    expect(validateFailureLedger(currentLedger([row({ rerunResult: null })]))).toMatchObject({
      status: 'current-failures',
    });
  });

  test('rejects a current-failures shape with no failures', () => {
    expect(() => validateFailureLedger(currentLedger([]))).toThrow();
  });

  test('rejects missing required row fields', () => {
    const requiredFields: Array<keyof FailureLedgerRow> = [
      'id',
      'suiteCommand',
      'suiteExitCode',
      'firstError',
      'contractRef',
      'owner',
      'rerunCommand',
      'rerunResult',
      'closureEvidence',
    ];

    for (const field of requiredFields) {
      const invalid = { ...row() } as Record<string, unknown>;
      delete invalid[field];
      expect(() => validateFailureLedger(currentLedger([invalid as unknown as FailureLedgerRow]))).toThrow();
    }
  });

  test('rejects empty required strings and invalid numeric fields', () => {
    expect(() => validateFailureLedger(currentLedger([row({ id: ' ' })]))).toThrow();
    expect(() => validateFailureLedger(currentLedger([row({ suiteCommand: '' })]))).toThrow();
    expect(() => validateFailureLedger(currentLedger([row({ firstError: '' })]))).toThrow();
    expect(() => validateFailureLedger(currentLedger([row({ contractRef: '' })]))).toThrow();
    expect(() => validateFailureLedger(currentLedger([row({ owner: '' })]))).toThrow();
    expect(() => validateFailureLedger(currentLedger([row({ rerunCommand: '' })]))).toThrow();
    expect(() => validateFailureLedger(currentLedger([row({ suiteExitCode: '1' as unknown as number })]))).toThrow();
  });

  test('rejects malformed rerun results and closure evidence', () => {
    expect(() => validateFailureLedger(currentLedger([row({ rerunResult: {} as RerunResult })]))).toThrow();
    expect(() => validateFailureLedger(currentLedger([row({ closureEvidence: [''] })]))).toThrow();
    expect(() => validateFailureLedger(currentLedger([row({ rerunResult: null, closureEvidence: [] })]))).toThrow();
  });

  test('rejects missing or extra rerun keys and invalid rerun types', () => {
    const missingRequired = { ...rerunResult } as Record<string, unknown>;
    delete missingRequired.observedAt;
    expect(() => validateFailureLedger(currentLedger([row({ rerunResult: missingRequired as unknown as RerunResult })]))).toThrow();

    const extraKey = { ...rerunResult, unexpected: true } as RerunResult;
    expect(() => validateFailureLedger(currentLedger([row({ rerunResult: extraKey })]))).toThrow();

    const invalidTypes = [
      { ...rerunResult, suiteCommand: 42 },
      { ...rerunResult, exitCode: '1' },
      { ...rerunResult, firstError: '' },
      { ...rerunResult, firstError: 42 },
      { ...rerunResult, observedAt: 42 },
    ];
    for (const invalid of invalidTypes) {
      expect(() => validateFailureLedger(currentLedger([row({ rerunResult: invalid as unknown as RerunResult })]))).toThrow();
    }
  });

  test('rejects extra row fields', () => {
    const extraField = { ...row(), unexpected: true } as FailureLedgerRow;
    expect(() => validateFailureLedger(currentLedger([extraField]))).toThrow();
  });

  test('rejects duplicate IDs', () => {
    expect(() => validateFailureLedger(currentLedger([row(), row({ id: 'failure-1' })]))).toThrow();
  });

  test('rejects stale-only rows', () => {
    const staleRow = { ...row(), status: 'stale' } as unknown as FailureLedgerRow;
    expect(() => validateFailureLedger(currentLedger([staleRow]))).toThrow();
  });
});
