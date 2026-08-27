export interface EvidenceRef {
  readonly source: string;
  readonly observedAt: string;
  readonly locator?: string;
}

export interface Known<T> {
  readonly kind: 'known';
  readonly value: T;
  readonly evidence: EvidenceRef;
}

export interface Unknown {
  readonly kind: 'unknown';
  readonly reasonCode: string;
  readonly observedAt: string;
  readonly recovery?: string;
}

export interface Violation {
  readonly code: string;
  readonly message?: string;
}

export interface RecoveryAction {
  readonly code: string;
  readonly description?: string;
}

export type GateFailureKind = 'fail' | 'blocked' | 'unknown';

export type GateResult<T> =
  | {
      readonly kind: 'pass';
      readonly value: T;
      readonly evidence: readonly EvidenceRef[];
    }
  | {
      readonly kind: GateFailureKind;
      readonly violations: readonly Violation[];
      readonly recovery: readonly RecoveryAction[];
    };

const RFC_3339_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isDenseArray(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) return false;
  }
  return true;
}

const EVIDENCE_KEYS = ['source', 'observedAt', 'locator'] as const;
const KNOWN_KEYS = ['kind', 'value', 'evidence'] as const;
const UNKNOWN_KEYS = ['kind', 'reasonCode', 'observedAt', 'recovery'] as const;
const VIOLATION_KEYS = ['code', 'message'] as const;
const RECOVERY_KEYS = ['code', 'description'] as const;

export function isRfc3339Timestamp(value: unknown): value is string {
  const timestamp = typeof value === 'string' ? value : null;
  if (timestamp === null) {
    return false;
  }
  const match = RFC_3339_TIMESTAMP.exec(timestamp);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  return day <= daysInMonth && Number.isFinite(Date.parse(timestamp));
}

export function validateTimestamp(value: string): string {
  if (!isRfc3339Timestamp(value)) {
    throw new TypeError(`Expected an RFC 3339 timestamp, received: ${value}`);
  }
  return value;
}

export function validateEvidenceRef(value: unknown): EvidenceRef {
  if (!isRecord(value) || !hasOnlyKeys(value, EVIDENCE_KEYS)
    || !hasOwn(value, 'source') || !hasOwn(value, 'observedAt')
    || !nonEmptyString(value.source) || !isRfc3339Timestamp(value.observedAt)) {
    throw new TypeError('EvidenceRef requires non-empty source and RFC 3339 observedAt');
  }
  if (hasOwn(value, 'locator') && value.locator !== undefined && typeof value.locator !== 'string') {
    throw new TypeError('EvidenceRef locator must be a string when present');
  }
  return value as unknown as EvidenceRef;
}

export function known<T>(value: T, evidence: EvidenceRef): Known<T>;
export function known<T>(value: T, source: string, observedAt: string, locator?: string): Known<T>;
export function known<T>(
  value: T,
  evidenceOrSource: EvidenceRef | string,
  observedAt?: string,
  locator?: string,
): Known<T> {
  const evidence =
    typeof evidenceOrSource === 'string'
      ? { source: evidenceOrSource, observedAt: observedAt ?? '', ...(locator === undefined ? {} : { locator }) }
      : evidenceOrSource;
  validateEvidenceRef(evidence);
  return { kind: 'known', value, evidence };
}
export function unknown(reasonCode: string, observedAt: string, recovery?: string): Unknown {
  if (!nonEmptyString(reasonCode)) throw new TypeError('Unknown requires a non-empty reasonCode');
  validateTimestamp(observedAt);
  if (recovery !== undefined && !nonEmptyString(recovery)) {
    throw new TypeError('Unknown recovery must be non-empty when present');
  }
  return recovery === undefined
    ? { kind: 'unknown', reasonCode, observedAt }
    : { kind: 'unknown', reasonCode, observedAt, recovery };
}

export function validateKnown<T>(value: unknown): Known<T> {
  if (!isRecord(value) || !hasOnlyKeys(value, KNOWN_KEYS)
    || value.kind !== 'known' || !hasOwn(value, 'value') || value.value === null || value.value === undefined
    || !hasOwn(value, 'evidence')) {
    throw new TypeError('Known requires non-null value and valid evidence');
  }
  validateEvidenceRef(value.evidence);
  return value as unknown as Known<T>;
}

export function isKnown<T>(value: unknown): value is Known<T> {
  try {
    validateKnown<T>(value);
    return true;
  } catch {
    return false;
  }
}

export function validateUnknown(value: unknown): Unknown {
  if (!isRecord(value) || !hasOnlyKeys(value, UNKNOWN_KEYS)
    || value.kind !== 'unknown' || !hasOwn(value, 'reasonCode') || !hasOwn(value, 'observedAt')
    || !nonEmptyString(value.reasonCode) || !isRfc3339Timestamp(value.observedAt)
    || (hasOwn(value, 'recovery') && value.recovery !== undefined && !nonEmptyString(value.recovery))) {
    throw new TypeError('Unknown requires a non-empty reasonCode and RFC 3339 observedAt');
  }
  return value as unknown as Unknown;
}

export function isUnknown(value: unknown): value is Unknown {
  try {
    validateUnknown(value);
    return true;
  } catch {
    return false;
  }
}


export function validateViolation(value: unknown): Violation {
  if (!isRecord(value) || !hasOnlyKeys(value, VIOLATION_KEYS) || !hasOwn(value, 'code') || !nonEmptyString(value.code)) {
    throw new TypeError('Violation requires a non-empty code');
  }
  if (hasOwn(value, 'message') && value.message !== undefined && typeof value.message !== 'string') {
    throw new TypeError('Violation message must be a string when present');
  }
  return value as unknown as Violation;
}

export function validateRecoveryAction(value: unknown): RecoveryAction {
  if (!isRecord(value) || !hasOnlyKeys(value, RECOVERY_KEYS) || !hasOwn(value, 'code') || !nonEmptyString(value.code)) {
    throw new TypeError('RecoveryAction requires a non-empty code');
  }
  if (hasOwn(value, 'description') && value.description !== undefined && typeof value.description !== 'string') {
    throw new TypeError('RecoveryAction description must be a string when present');
  }
  return value as unknown as RecoveryAction;
}

export function validateGateResult<T>(value: unknown): GateResult<T> {
  if (!isRecord(value)) throw new TypeError('GateResult must be an object');
  if (value.kind === 'pass') {
    if (!hasOnlyKeys(value, ['kind', 'value', 'evidence'])
      || !hasOwn(value, 'value') || !hasOwn(value, 'evidence') || !isDenseArray(value.evidence)) {
      throw new TypeError('A passing GateResult requires value and dense evidence fields');
    }
    for (const item of value.evidence) validateEvidenceRef(item);
    return value as GateResult<T>;
  }
  if (value.kind !== 'fail' && value.kind !== 'blocked' && value.kind !== 'unknown') {
    throw new TypeError('GateResult kind must be pass, fail, blocked, or unknown');
  }
  if (!hasOnlyKeys(value, ['kind', 'violations', 'recovery'])
    || !hasOwn(value, 'violations') || !hasOwn(value, 'recovery')
    || !isDenseArray(value.violations) || !isDenseArray(value.recovery)) {
    throw new TypeError('A failing GateResult requires dense violations and recovery arrays');
  }
  for (const item of value.violations) validateViolation(item);
  for (const item of value.recovery) validateRecoveryAction(item);
  return value as GateResult<T>;
}

export function isGateResult<T>(value: unknown): value is GateResult<T> {
  try {
    validateGateResult<T>(value);
    return true;
  } catch {
    return false;
  }
}
