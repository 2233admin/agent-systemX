import { describe, expect, test } from 'bun:test';
import {
  isCommandsEvidence,
  isFailureLedger,
  isOwnershipRecord,
  validateCommandsEvidence,
  validateFailureLedger,
  validateOwnershipRecord,
} from '../../src/validation/failure-ledger.ts';
import type { FailureLedger } from '../../src/validation/failure-ledger.ts';
import {
  currentFailureWithClosure,
  currentFailureWithRerun,
  validCommandsEvidence,
  typecheckOnlyCommandsEvidence,
  validOwnershipRecord,
  zeroFailureLedger,
} from '../fixtures/validation.ts';

function boundLedger(failures: readonly unknown[]) {
  return {
    status: 'current-failures',
    failures,
    currentHead: validCommandsEvidence.currentHead,
    commandsEvidence: validCommandsEvidence,
  } as unknown as FailureLedger;
}

describe('failure ledger validation', () => {
  test('accepts an explicit zero-failure ledger', () => {
    expect(validateFailureLedger(zeroFailureLedger)).toEqual(zeroFailureLedger);
    expect(isFailureLedger(zeroFailureLedger)).toBe(true);
  });

  test('rejects an unbound zero-failure ledger', () => {
    expect(() => validateFailureLedger({ status: 'zero-failures', failures: [] })).toThrow(
      'FailureLedger requires status, currentHead, commandsEvidence, and a dense failures array',
    );
  });

  test('rejects a ledger whose current head differs from command evidence', () => {
    const ledger = { ...zeroFailureLedger, currentHead: 'different-head' };
    expect(() => validateFailureLedger(ledger)).toThrow(
      'FailureLedger currentHead must match commandsEvidence currentHead',
    );
  });

  test('rejects zero-failures evidence without the full-suite command', () => {
    const ledger = { ...zeroFailureLedger, commandsEvidence: typecheckOnlyCommandsEvidence };
    expect(() => validateFailureLedger(ledger)).toThrow(
      'zero-failures ledger requires a passing harness-full-suite command',
    );
  });

  test('accepts a current failure with a rerun result', () => {
    const ledger = boundLedger([currentFailureWithRerun]);
    expect(validateFailureLedger(ledger)).toEqual(ledger);
  });

  test('accepts a current failure with closure evidence', () => {
    const ledger = boundLedger([currentFailureWithClosure]);
    expect(validateFailureLedger(ledger)).toEqual(ledger);
  });

  test('rejects a row with both rerun fields absent', () => {
    const { rerunResult: _rerunResult, closureEvidence: _closureEvidence, ...row } = currentFailureWithRerun;
    expect(() => validateFailureLedger(boundLedger([row]))).toThrow(
      'FailureLedger row requires all identity, error, owner, and rerun fields',
    );
  });

  test('rejects a row with both rerun fields empty', () => {
    const row = { ...currentFailureWithRerun, rerunResult: null, closureEvidence: [] };
    expect(() => validateFailureLedger(boundLedger([row]))).toThrow(
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
    expect(() => validateFailureLedger(boundLedger([row]))).toThrow(
      'FailureLedger row requires rerunResult or closureEvidence',
    );
  });

  test('rejects a missing owner', () => {
    const { owner: _owner, ...row } = currentFailureWithRerun;
    expect(() => validateFailureLedger(boundLedger([row]))).toThrow(
      'FailureLedger row requires all identity, error, owner, and rerun fields',
    );
  });

  test('rejects duplicate failure IDs', () => {
    const duplicate = { ...currentFailureWithClosure, id: currentFailureWithRerun.id };
    expect(() => validateFailureLedger(boundLedger([currentFailureWithRerun, duplicate]))).toThrow(
      'FailureLedger row IDs must be unique',
    );
  });
});

describe('ownership and command evidence validation', () => {
  test('accepts an ownership record', () => {
    expect(validateOwnershipRecord(validOwnershipRecord)).toEqual(validOwnershipRecord);
    expect(isOwnershipRecord(validOwnershipRecord)).toBe(true);
  });


  test('rejects owned and attributed-dirty path overlap', () => {
    const record = {
      ...validOwnershipRecord,
      attributedDirtyPaths: [validOwnershipRecord.ownedPaths[0]],
    };
    expect(() => validateOwnershipRecord(record)).toThrow(
      'OwnershipRecord ownedPaths must not overlap attributedDirtyPaths',
    );
  });

  test('rejects owned and untracked path overlap', () => {
    const record = {
      ...validOwnershipRecord,
      untrackedPaths: [validOwnershipRecord.ownedPaths[0]],
    };
    expect(() => validateOwnershipRecord(record)).toThrow(
      'OwnershipRecord ownedPaths must not overlap untrackedPaths',
    );
  });

  test('rejects owned and conflicting path overlap', () => {
    const record = {
      ...validOwnershipRecord,
      conflictingPaths: [validOwnershipRecord.ownedPaths[0]],
    };
    expect(() => validateOwnershipRecord(record)).toThrow(
      'OwnershipRecord ownedPaths must not overlap conflictingPaths',
    );
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

  test('accepts the Windows cmd.exe, bun, and bunx command forms', () => {
    const commands = {
      ...validCommandsEvidence,
      commands: [
        { ...validCommandsEvidence.commands[0], name: 'cmd', command: 'cmd.exe /d /c "bun test"' },
        { ...validCommandsEvidence.commands[0], name: 'bun', command: 'bun test packages/harness-engine/tests' },
        { ...validCommandsEvidence.commands[0], name: 'bunx', command: 'bunx tsc --noEmit -p packages/harness-engine/tsconfig.json' },
      ] as const,
    };
    expect(validateCommandsEvidence(commands)).toEqual(commands);
  });

  test('rejects sensitive or non-allowlisted command strings', () => {
    for (const command of [
      'bun test --token=secret',
      'bun test --password=secret',
      'bun test --credential=secret',
      'bun test --secret=secret',
      'bun test prompt transcript tool payload stderr',
      'bun test https://user:password@example.com',
    ]) {
      const evidence = {
        ...validCommandsEvidence,
        commands: [{ ...validCommandsEvidence.commands[0], command }],
      };
      expect(() => validateCommandsEvidence(evidence)).toThrow(
        'CommandEvidence command contains prohibited sensitive content',
      );
    }
    expect(() => validateCommandsEvidence({
      ...validCommandsEvidence,
      commands: [{ ...validCommandsEvidence.commands[0], command: 'bash -c "bun test"' }],
    })).toThrow('CommandEvidence command must use the safe executable allowlist');
  });

  test('accepts allowlisted summaries and explicit redaction', () => {
    const summary = {
      ...validCommandsEvidence,
      commands: [{
        ...validCommandsEvidence.commands[0],
        output: 'bun test v1.3.14 (0d9b296a)\n\n 32 pass\n 0 fail\n 81 expect() calls\nRan 32 tests across 3 files. [201.00ms]',
      }] as const,
    };
    expect(validateCommandsEvidence(summary)).toEqual(summary);
    expect(validateCommandsEvidence({
      ...validCommandsEvidence,
      commands: [{ ...validCommandsEvidence.commands[0], output: '[redacted] command output' }],
    })).toBeTruthy();
  });

  test('rejects sensitive or non-allowlisted command output', () => {
    for (const sensitive of ['prompt', 'transcript', 'credential', 'tool payload', 'stderr']) {
      const evidence = {
        ...validCommandsEvidence,
        commands: [{ ...validCommandsEvidence.commands[0], output: `${sensitive}: private data` }],
      };
      expect(() => validateCommandsEvidence(evidence)).toThrow(
        'CommandEvidence output contains prohibited sensitive content',
      );
    }
    expect(() => validateCommandsEvidence({
      ...validCommandsEvidence,
      commands: [{ ...validCommandsEvidence.commands[0], output: 'unstructured output' }],
    })).toThrow('CommandEvidence output must match the summary allowlist or [redacted]');
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
