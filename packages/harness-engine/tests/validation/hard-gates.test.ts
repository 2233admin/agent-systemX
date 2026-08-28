import { describe, expect, test } from 'bun:test';
import type { EvidenceRef } from '../../src/core/result.ts';
import {
  type HardGateRecord,
  type ValidationDecision,
  validateHardGateBundle,
  validateValidationDecision,
} from '../../src/validation/hard-gates.ts';

const head = 'a'.repeat(40);
const sourceHash = 'b'.repeat(64);
const manifestHash = 'c'.repeat(64);
const observedAt = '2026-08-28T12:00:00.000Z';

function evidence(source: string, locator?: string): EvidenceRef {
  return { source, observedAt, ...(locator === undefined ? {} : { locator }) };
}

function gate(
  gateId: HardGateRecord['gateId'],
  state: HardGateRecord['state'] = 'pass',
  evidenceRefs: readonly EvidenceRef[] = [evidence(`stage7.${gateId}`)],
  failureRefs: readonly EvidenceRef[] = [],
): HardGateRecord {
  return {
    gateId,
    state,
    currentHead: head,
    sourceHash,
    evidenceRefs,
    failureRefs,
    owner: 'stage7-reviewer',
    observedAt,
  };
}

function validGates(): readonly HardGateRecord[] {
  return [
    gate('code-tests'),
    gate('failure-ledger'),
    gate('ownership'),
    gate('independent-review'),
    gate('controlled-integration'),
    gate('real-smoke', 'pass', [
      evidence('real-smoke.orca', 'orca://run/run-1'),
      evidence('real-smoke.github', 'github://owner/repo/pr/1'),
      evidence('real-smoke.host.omp', 'host://omp/18.0.3'),
    ]),
  ];
}

function decision(overrides: Partial<ValidationDecision> = {}): ValidationDecision {
  return {
    currentHead: head,
    sourceHash,
    state: 'Verified',
    gates: validGates() as unknown as ValidationDecision['gates'],
    evidenceManifestHash: manifestHash,
    observedAt,
    ...overrides,
  };
}

describe('Stage 7 hard gate bundle', () => {
  test('accepts exactly six aligned typed gates and derives Verified', () => {
    const gates = validateHardGateBundle(validGates());
    expect(gates).toHaveLength(6);
    expect(validateValidationDecision(decision()).state).toBe('Verified');
  });

  test('rejects a bundle with a missing hard gate', () => {
    expect(() => validateHardGateBundle(validGates().slice(0, 5))).toThrow('exactly six');
  });

  test('rejects a gate with mismatched current head or source hash', () => {
    expect(() => validateHardGateBundle(validGates().map((item, index) => index === 1
      ? { ...item, currentHead: 'd'.repeat(40) }
      : item))).toThrow('currentHead');
    expect(() => validateHardGateBundle(validGates().map((item, index) => index === 1
      ? { ...item, sourceHash: 'e'.repeat(64) }
      : item))).toThrow('sourceHash');
  });

  test('rejects pass with failure references', () => {
    expect(() => validateHardGateBundle(validGates().map((item, index) => index === 0
      ? { ...item, failureRefs: [evidence('failure.current')] }
      : item))).toThrow('failureRefs');
  });

  test('rejects untyped string-only evidence references', () => {
    expect(() => validateHardGateBundle(validGates().map((item, index) => index === 0
      ? { ...item, evidenceRefs: ['human description'] as never }
      : item))).toThrow('EvidenceRef');
  });

  test('rejects sensitive evidence and owner content', () => {
    expect(() => validateHardGateBundle(validGates().map((item, index) => index === 0
      ? { ...item, evidenceRefs: [evidence('secret-token-source')] }
      : item))).toThrow('sensitive');
    expect(() => validateHardGateBundle(validGates().map((item, index) => index === 0
      ? { ...item, owner: 'worker-password' }
      : item))).toThrow('sensitive');
  });

  test('rejects real-smoke pass when denominator lacks natural Orca, GitHub, or host evidence', () => {
    const missingHost = validGates().map((item) => item.gateId === 'real-smoke'
      ? { ...item, evidenceRefs: [evidence('real-smoke.orca', 'orca://run/run-1'), evidence('real-smoke.github', 'github://owner/repo/pr/1')] }
      : item);
    expect(() => validateHardGateBundle(missingHost)).toThrow('host');

    const fixtureOnly = validGates().map((item) => item.gateId === 'real-smoke'
      ? { ...item, evidenceRefs: [evidence('fixture.real-smoke.orca', 'fixture://orca'), evidence('fixture.real-smoke.github', 'fixture://github'), evidence('help.exit-0.host', 'static://help')] }
      : item);
    expect(() => validateHardGateBundle(fixtureOnly)).toThrow('real-smoke');
  });

  test('keeps not-available real smoke explicit and non-passing', () => {
    const gates = validGates().map((item) => item.gateId === 'real-smoke'
      ? { ...item, state: 'not-available' as const, evidenceRefs: [evidence('real-smoke.orca')] }
      : item);
    expect(validateValidationDecision(decision({ state: 'Partial', gates: gates as unknown as ValidationDecision['gates'] })).state).toBe('Partial');
    expect(() => validateValidationDecision(decision({ state: 'Verified', gates: gates as unknown as ValidationDecision['gates'] }))).toThrow('state');
  });

  test('rejects a ValidationDecision with stale head or incorrect manifest hash', () => {
    expect(() => validateValidationDecision(decision({ currentHead: 'd'.repeat(40) }))).toThrow('currentHead');
    expect(() => validateValidationDecision(decision({ evidenceManifestHash: 'not-a-hash' }))).toThrow('evidenceManifestHash');
  });

  test('maps failed, blocked, and unknown gates to non-Verified states', () => {
    const failed = validGates().map((item) => item.gateId === 'code-tests'
      ? { ...item, state: 'fail' as const, failureRefs: [evidence('failure.current')] }
      : item);
    expect(validateValidationDecision(decision({ state: 'Partial', gates: failed as unknown as ValidationDecision['gates'] })).state).toBe('Partial');

    const blocked = validGates().map((item) => item.gateId === 'ownership'
      ? { ...item, state: 'blocked' as const, failureRefs: [evidence('ownership.conflict')] }
      : item);
    expect(validateValidationDecision(decision({ state: 'Blocked', gates: blocked as unknown as ValidationDecision['gates'] })).state).toBe('Blocked');

    const unknown = validGates().map((item) => item.gateId === 'failure-ledger'
      ? { ...item, state: 'unknown' as const, failureRefs: [evidence('ledger.unknown')] }
      : item);
    expect(validateValidationDecision(decision({ state: 'Unknown', gates: unknown as unknown as ValidationDecision['gates'] })).state).toBe('Unknown');
  });
});
