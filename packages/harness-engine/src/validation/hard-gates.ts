import type { EvidenceRef, RecoveryAction } from '../core/result.ts';
import { isRfc3339Timestamp, validateEvidenceRef, validateRecoveryAction } from '../core/result.ts';

export type HardGateId =
  | 'code-tests'
  | 'failure-ledger'
  | 'ownership'
  | 'independent-review'
  | 'controlled-integration'
  | 'real-smoke';

export type HardGateState = 'pass' | 'fail' | 'blocked' | 'unknown' | 'not-available';

export interface HardGateRecord {
  readonly gateId: HardGateId;
  readonly state: HardGateState;
  readonly currentHead: string;
  readonly sourceHash: string;
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly failureRefs: readonly EvidenceRef[];
  readonly owner: string;
  readonly observedAt: string;
  readonly recoveryAction?: RecoveryAction;
}
export type HardGateResult = HardGateRecord;

export type ValidationState = 'Partial' | 'Draft' | 'Blocked' | 'Unknown' | 'Verified';

export interface ValidationDecision {
  readonly currentHead: string;
  readonly sourceHash: string;
  readonly state: ValidationState;
  readonly gates: readonly [
    HardGateRecord,
    HardGateRecord,
    HardGateRecord,
    HardGateRecord,
    HardGateRecord,
    HardGateRecord,
  ];
  readonly evidenceManifestHash: string;
  readonly observedAt: string;
}

const GATE_IDS: readonly HardGateId[] = [
  'code-tests',
  'failure-ledger',
  'ownership',
  'independent-review',
  'controlled-integration',
  'real-smoke',
];
const GATE_STATES: readonly HardGateState[] = ['pass', 'fail', 'blocked', 'unknown', 'not-available'];
const VALIDATION_STATES: readonly ValidationState[] = ['Partial', 'Draft', 'Blocked', 'Unknown', 'Verified'];
const HEX_HASH = /^[0-9a-f]{16,128}$/i;
const SENSITIVE = /\b(?:prompt|transcript|credential|password|secret|token|stderr)\b|tool[\s_-]*payload|(?:https?|ssh|git):\/\/[^\s/]+@/i;
const DISALLOWED_SMOKE = /(?:fixture|fake|static|help|exit(?:[-_.:]?0)?|not[-_.:]?available|controlled)/i;
const EVIDENCE_KEYS = ['source', 'observedAt', 'locator'] as const;
const GATE_KEYS = ['gateId', 'state', 'currentHead', 'sourceHash', 'evidenceRefs', 'failureRefs', 'owner', 'observedAt', 'recoveryAction'] as const;
const DECISION_KEYS = ['currentHead', 'sourceHash', 'state', 'gates', 'evidenceManifestHash', 'observedAt'] as const;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: RecordValue, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function hasOwn(value: RecordValue, key: string): boolean {
  return Object.hasOwn(value, key);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function denseArray(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) return false;
  }
  return true;
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && HEX_HASH.test(value.trim());
}

function safeText(value: unknown): value is string {
  return nonEmpty(value) && !SENSITIVE.test(value);
}

function validateEvidence(value: unknown, field: string): EvidenceRef {
  if (!isRecord(value) || !hasOnlyKeys(value, EVIDENCE_KEYS)) {
    throw new TypeError(`${field} must contain a typed EvidenceRef`);
  }
  const evidence = validateEvidenceRef(value);
  if (evidence.locator !== undefined && (!nonEmpty(evidence.locator) || SENSITIVE.test(evidence.locator))) {
    throw new TypeError(`${field} locator is invalid or sensitive`);
  }
  if (SENSITIVE.test(evidence.source)) {
    throw new TypeError(`${field} source is sensitive`);
  }
  return evidence;
}

function validateEvidenceRefs(value: unknown, field: string): readonly EvidenceRef[] {
  if (!denseArray(value) || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty dense array`);
  }
  return value.map((item, index) => validateEvidence(item, `${field}[${index}]`));
}

function validSmokeKind(value: EvidenceRef): 'orca' | 'github' | 'host' | undefined {
  const source = value.source.toLowerCase();
  if (source === 'real-smoke.orca') return 'orca';
  if (source === 'real-smoke.github') return 'github';
  if (/^real-smoke\.(?:host|omp|claude|codex|opencode)(?:[.:/_-].*)?$/.test(source)) return 'host';
  return undefined;
}

function realSmokeKinds(refs: readonly EvidenceRef[]): ReadonlySet<'orca' | 'github' | 'host'> {
  const kinds = new Set<'orca' | 'github' | 'host'>();
  for (const ref of refs) {
    if (DISALLOWED_SMOKE.test(ref.source) || (ref.locator !== undefined && DISALLOWED_SMOKE.test(ref.locator))) continue;
    const kind = validSmokeKind(ref);
    if (kind !== undefined && ref.locator !== undefined) kinds.add(kind);
  }
  return kinds;
}

function validateGate(value: unknown, expectedHead?: string, expectedSourceHash?: string): HardGateRecord {
  if (!isRecord(value) || !hasOnlyKeys(value, GATE_KEYS)
    || !GATE_KEYS.filter((key) => key !== 'recoveryAction').every((key) => hasOwn(value, key))) {
    throw new TypeError('HardGateRecord requires all typed gate fields');
  }
  if (!GATE_IDS.includes(value.gateId as HardGateId)) throw new TypeError('HardGateRecord gateId is invalid');
  if (!GATE_STATES.includes(value.state as HardGateState)) throw new TypeError('HardGateRecord state is invalid');
  if (!validHash(value.currentHead)) throw new TypeError('HardGateRecord currentHead must be a concrete hash');
  if (!validHash(value.sourceHash)) throw new TypeError('HardGateRecord sourceHash must be a concrete hash');
  if (expectedHead !== undefined && value.currentHead !== expectedHead) throw new TypeError('HardGateRecord currentHead drift');
  if (expectedSourceHash !== undefined && value.sourceHash !== expectedSourceHash) throw new TypeError('HardGateRecord sourceHash drift');
  if (!safeText(value.owner)) throw new TypeError('HardGateRecord owner is invalid or sensitive');
  if (!isRfc3339Timestamp(value.observedAt)) throw new TypeError('HardGateRecord observedAt must be RFC 3339');
  const evidenceRefs = validateEvidenceRefs(value.evidenceRefs, 'HardGateRecord evidenceRefs');
  if (!denseArray(value.failureRefs)) throw new TypeError('HardGateRecord failureRefs must be a dense array');
  const failureRefs = value.failureRefs.map((item, index) => validateEvidence(item, `HardGateRecord failureRefs[${index}]`));
  if (value.state === 'pass' && failureRefs.length > 0) throw new TypeError('HardGateRecord pass cannot contain failureRefs');
  if (value.state !== 'pass' && value.state !== 'not-available' && failureRefs.length === 0) {
    throw new TypeError('Non-pass HardGateRecord requires failureRefs');
  }
  if (value.recoveryAction !== undefined) {
    validateRecoveryAction(value.recoveryAction);
    const action = value.recoveryAction as RecoveryAction;
    if (SENSITIVE.test(action.code) || (action.description !== undefined && SENSITIVE.test(action.description))) {
      throw new TypeError('HardGateRecord recoveryAction is sensitive');
    }
  }
  if (value.gateId === 'real-smoke' && value.state === 'pass') {
    const kinds = realSmokeKinds(evidenceRefs);
    if (!kinds.has('orca')) throw new TypeError('real-smoke pass requires natural Orca evidence');
    if (!kinds.has('github')) throw new TypeError('real-smoke pass requires natural GitHub evidence');
    if (!kinds.has('host')) throw new TypeError('real-smoke pass requires natural host evidence');
  }
  return {
    gateId: value.gateId as HardGateId,
    state: value.state as HardGateState,
    currentHead: value.currentHead,
    sourceHash: value.sourceHash,
    evidenceRefs,
    failureRefs,
    owner: value.owner,
    observedAt: value.observedAt,
    ...(value.recoveryAction === undefined ? {} : { recoveryAction: value.recoveryAction as RecoveryAction }),
  };
}

export function validateHardGateBundle(input: unknown): readonly HardGateRecord[] {
  const raw = isRecord(input) && hasOwn(input, 'gates') ? input.gates : input;
  if (!denseArray(raw) || raw.length !== GATE_IDS.length) {
    throw new TypeError('HardGate bundle requires exactly six gates');
  }
  const first = validateGate(raw[0]);
  const records = [first, ...raw.slice(1).map((item) => validateGate(item, first.currentHead, first.sourceHash))];
  const seen = new Set<HardGateId>();
  for (const record of records) {
    if (seen.has(record.gateId)) throw new TypeError('HardGate bundle gateIds must be unique');
    seen.add(record.gateId);
  }
  for (const gateId of GATE_IDS) {
    if (!seen.has(gateId)) throw new TypeError(`HardGate bundle missing ${gateId}`);
  }
  return records;
}

function computedState(gates: readonly HardGateRecord[]): ValidationState {
  if (gates.every((gate) => gate.state === 'pass')) {
    const smoke = gates.find((gate) => gate.gateId === 'real-smoke');
    if (smoke !== undefined && realSmokeKinds(smoke.evidenceRefs).size === 3) return 'Verified';
  }
  if (gates.some((gate) => gate.state === 'blocked')) return 'Blocked';
  if (gates.some((gate) => gate.state === 'unknown')) return 'Unknown';
  if (gates.some((gate) => gate.state === 'not-available')) return 'Partial';
  return 'Partial';
}

export function validateValidationDecision(input: unknown): ValidationDecision {
  if (!isRecord(input) || !hasOnlyKeys(input, DECISION_KEYS) || DECISION_KEYS.some((key) => !hasOwn(input, key))) {
    throw new TypeError('ValidationDecision requires all typed fields');
  }
  if (!validHash(input.currentHead)) throw new TypeError('ValidationDecision currentHead must be a concrete hash');
  if (!validHash(input.sourceHash)) throw new TypeError('ValidationDecision sourceHash must be a concrete hash');
  if (!VALIDATION_STATES.includes(input.state as ValidationState)) throw new TypeError('ValidationDecision state is invalid');
  if (!validHash(input.evidenceManifestHash)) throw new TypeError('ValidationDecision evidenceManifestHash must be a concrete hash');
  if (!isRfc3339Timestamp(input.observedAt)) throw new TypeError('ValidationDecision observedAt must be RFC 3339');
  const gates = validateHardGateBundle(input.gates);
  if (gates[0]?.currentHead !== input.currentHead) throw new TypeError('ValidationDecision currentHead does not match gates');
  if (gates[0]?.sourceHash !== input.sourceHash) throw new TypeError('ValidationDecision sourceHash does not match gates');
  const expected = computedState(gates);
  if (input.state !== expected) throw new TypeError(`ValidationDecision state must be ${expected}`);
  return {
    currentHead: input.currentHead,
    sourceHash: input.sourceHash,
    state: expected,
    gates: gates as ValidationDecision['gates'],
    evidenceManifestHash: input.evidenceManifestHash,
    observedAt: input.observedAt,
  };
}
