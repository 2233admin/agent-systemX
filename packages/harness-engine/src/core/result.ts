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
  return typeof value === 'object' && value !== null;
}

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

export function validateEvidenceRef(value: EvidenceRef): EvidenceRef {
  if (!isRecord(value) || typeof value.source !== 'string' || typeof value.observedAt !== 'string') {
    throw new TypeError('EvidenceRef requires source and observedAt strings');
  }
  validateTimestamp(value.observedAt);
  if (value.locator !== undefined && typeof value.locator !== 'string') {
    throw new TypeError('EvidenceRef locator must be a string when present');
  }
  return value;
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
  validateTimestamp(observedAt);
  return recovery === undefined
    ? { kind: 'unknown', reasonCode, observedAt }
    : { kind: 'unknown', reasonCode, observedAt, recovery };
}

export function isKnown<T>(value: unknown): value is Known<T> {
  return isRecord(value) && value.kind === 'known';
}

export function isUnknown(value: unknown): value is Unknown {
  return isRecord(value) && value.kind === 'unknown';
}

export function validateViolation(value: Violation): Violation {
  if (!isRecord(value) || typeof value.code !== 'string' || value.code.trim().length === 0) {
    throw new TypeError('Violation requires a non-empty code');
  }
  if (value.message !== undefined && typeof value.message !== 'string') {
    throw new TypeError('Violation message must be a string when present');
  }
  return value;
}

export function validateGateResult<T>(value: unknown): GateResult<T> {
  if (!isRecord(value)) {
    throw new TypeError('GateResult must be an object');
  }
  if (value.kind === 'pass') {
    if (!Object.hasOwn(value, 'value') || !Array.isArray(value.evidence)) {
      throw new TypeError('A passing GateResult requires value and evidence fields');
    }
    for (const item of value.evidence) {
      validateEvidenceRef(item);
    }
    return value as GateResult<T>;
  }
  if (value.kind !== 'fail' && value.kind !== 'blocked' && value.kind !== 'unknown') {
    throw new TypeError('GateResult kind must be pass, fail, blocked, or unknown');
  }
  if (!Array.isArray(value.violations) || !Array.isArray(value.recovery)) {
    throw new TypeError('A failing GateResult requires violations and recovery arrays');
  }
  for (const violation of value.violations) {
    validateViolation(violation);
  }
  return value as GateResult<T>;
}

export function isGateResult<T>(value: unknown): value is GateResult<T> {
  try {
    validateGateResult(value as GateResult<T>);
    return true;
  } catch {
    return false;
  }
}
