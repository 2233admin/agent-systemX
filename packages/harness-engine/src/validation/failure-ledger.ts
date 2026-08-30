export type FailureStatus = 'current' | 'stale';

export interface FailureRow {
  readonly id: string;
  readonly owner: string;
  readonly rerunCommand: string;
  readonly rerunResult: unknown;
  readonly closureEvidence: unknown;
  readonly status?: FailureStatus;
  readonly state?: FailureStatus;
  readonly stale?: boolean;
  readonly [key: string]: unknown;
}

export type FailureLedger = readonly [] | readonly [FailureRow, ...FailureRow[]];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function isPopulated(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

function rowIsCurrent(row: Record<string, unknown>): boolean {
  const statuses = [row.status, row.state].filter((value) => value !== undefined);
  if (statuses.some((value) => value !== 'current' && value !== 'stale')) {
    throw new TypeError('Failure row status must be current or stale');
  }
  if (statuses.length === 2 && statuses[0] !== statuses[1]) {
    throw new TypeError('Failure row status and state must agree');
  }
  if (hasOwn(row, 'stale') && typeof row.stale !== 'boolean') {
    throw new TypeError('Failure row stale must be a boolean when present');
  }
  if (statuses.includes('current') && row.stale === true) {
    throw new TypeError('Current failure row cannot be marked stale');
  }
  if (statuses.includes('stale') && row.stale === false) {
    throw new TypeError('Stale failure row cannot be marked current');
  }
  if (statuses.includes('current')) return true;
  if (statuses.includes('stale')) return false;
  return row.stale !== true;
}

function validateRow(value: unknown): { row: FailureRow; current: boolean } {
  if (!isRecord(value)) throw new TypeError('Failure ledger rows must be objects');
  if (!hasOwn(value, 'id') || !nonEmptyString(value.id)) {
    throw new TypeError('Failure row requires a non-empty id');
  }
  if (!hasOwn(value, 'owner') || !nonEmptyString(value.owner)) {
    throw new TypeError('Failure row requires a non-empty owner');
  }
  if (!hasOwn(value, 'rerunCommand') || !nonEmptyString(value.rerunCommand)) {
    throw new TypeError('Failure row requires a non-empty rerunCommand');
  }

  const current = rowIsCurrent(value);
  if (current) {
    if (!hasOwn(value, 'rerunResult') || !hasOwn(value, 'closureEvidence')) {
      throw new TypeError('Current failure row must contain rerunResult and closureEvidence');
    }
    if (!isPopulated(value.rerunResult) && !isPopulated(value.closureEvidence)) {
      throw new TypeError('Current failure row requires rerunResult or closureEvidence');
    }
  }
  return { row: value as unknown as FailureRow, current };
}

export function validateFailureLedger(value: unknown): FailureLedger {
  if (!isDenseArray(value)) throw new TypeError('Failure ledger must be a dense array');
  if (value.length === 0) return [];

  const ids = new Set<string>();
  let currentCount = 0;
  const rows: FailureRow[] = [];
  for (const item of value) {
    const validated = validateRow(item);
    if (ids.has(validated.row.id)) throw new TypeError(`Duplicate failure id: ${validated.row.id}`);
    ids.add(validated.row.id);
    if (validated.current) currentCount += 1;
    rows.push(validated.row);
  }
  if (currentCount === 0) throw new TypeError('Failure ledger cannot contain only stale rows');
  return rows as [FailureRow, ...FailureRow[]];
}

export function isFailureLedger(value: unknown): value is FailureLedger {
  try {
    validateFailureLedger(value);
    return true;
  } catch {
    return false;
  }
}
