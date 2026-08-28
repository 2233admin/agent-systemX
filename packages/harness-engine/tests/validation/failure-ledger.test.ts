import { describe, expect, test } from 'bun:test';
import {
  isCommandsEvidence,
  isFailureLedger,
  isOwnershipRecord,
  validateCommandsEvidence,
  validateFailureLedger,
  validateOwnershipRecord,
} from '../../src/validation/failure-ledger.ts';
import {
  currentFailureWithClosure,
  currentFailureWithRerun,
  validCommandsEvidence,
  validOwnershipRecord,
  zeroFailureLedger,
} from '../fixtures/validation.ts';

describe('failure ledger validation', () => {
  test('accepts an explicit zero-failure ledger', () => {
    expect(validateFailureLedger(zeroFailureLedger)).toEqual(zeroFailureLedger);
    expect(isFailureLedger(zeroFailureLedger)).toBe(true);
  });

  test('accepts a current failure with a rerun result', () => {
    const ledger = { status: 'current-failures', failures: [currentFailureWithRerun] } as const;
    expect(validateFailureLedger(ledger)).toEqual(ledger);
  });

  test('accepts a current failure with closure evidence', () => {
    const ledger = { status: 'current-failures', failures: [currentFailureWithClosure] } as const;
    expect(validateFailureLedger(ledger)).toEqual(ledger);
  });

  test('rejects a row with both rerun fields absent', () => {
    const { rerunResult: _rerunResult, closureEvidence: _closureEvidence, ...row } = currentFailureWithRerun;
    expect(() => validateFailureLedger({ status: 'current-failures', failures: [row] })).toThrow(
      'FailureLedger row requires all identity, error, owner, and rerun fields',
    );
  });

  test('rejects a row with both rerun fields empty', () => {
    const row = { ...currentFailureWithRerun, rerunResult: null, closureEvidence: [] };
    expect(() => validateFailureLedger({ status: 'current-failures', failures: [row] })).toThrow(
      'FailureLedger row requires rerunResult or closureEvidence',
    );
  });

  test('rejects a stale-only row without current rerun or closure evidence', () => {
    const row = {
      ...currentFailureWithRerun,
      suiteCommand: 'historical command',
      rerunCommand: 'historical rerun command',
      rerunResult: null,
      closureEvidence: [],
    };
    expect(() => validateFailureLedger({ status: 'current-failures', failures: [row] })).toThrow(
      'FailureLedger row requires rerunResult or closureEvidence',
    );
  });

  test('rejects a missing owner', () => {
    const { owner: _owner, ...row } = currentFailureWithRerun;
    expect(() => validateFailureLedger({ status: 'current-failures', failures: [row] })).toThrow(
      'FailureLedger row requires all identity, error, owner, and rerun fields',
    );
  });

  test('rejects duplicate failure IDs', () => {
    const duplicate = { ...currentFailureWithClosure, id: currentFailureWithRerun.id };
    expect(() => validateFailureLedger({
      status: 'current-failures',
      failures: [currentFailureWithRerun, duplicate],
    })).toThrow('FailureLedger row IDs must be unique');
  });
});

describe('ownership and command evidence validation', () => {
  test('accepts an ownership record', () => {
    expect(validateOwnershipRecord(validOwnershipRecord)).toEqual(validOwnershipRecord);
    expect(isOwnershipRecord(validOwnershipRecord)).toBe(true);
  });

  test('rejects duplicate ownership paths', () => {
    const record = {
      ...validOwnershipRecord,
      ownedPaths: [...validOwnershipRecord.ownedPaths, validOwnershipRecord.ownedPaths[0]],
    };
    expect(() => validateOwnershipRecord(record)).toThrow('ownedPaths must not contain duplicate values');
  });

  test('accepts command evidence with an empty output', () => {
    expect(validateCommandsEvidence(validCommandsEvidence)).toEqual(validCommandsEvidence);
    expect(isCommandsEvidence(validCommandsEvidence)).toBe(true);
  });

  test('rejects duplicate command names', () => {
    const command = validCommandsEvidence.commands[0];
    const evidence = { ...validCommandsEvidence, commands: [command, command] };
    expect(() => validateCommandsEvidence(evidence)).toThrow('command names must be unique');
  });

  test('rejects commands evidence without commands', () => {
    expect(() => validateCommandsEvidence({
      ...validCommandsEvidence,
      commands: [],
    })).toThrow('at least one command');
  });
});
