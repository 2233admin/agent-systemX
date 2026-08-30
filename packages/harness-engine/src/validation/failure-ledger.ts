export interface RerunResult {
  readonly suiteCommand: string;
  readonly exitCode: number;
  readonly firstError?: string;
  readonly observedAt: string;
}

export interface FailureLedgerRow {
  readonly id: string;
  readonly suiteCommand: string;
  readonly suiteExitCode: number;
  readonly firstError: string;
  readonly contractRef: string;
  readonly owner: string;
  readonly rerunCommand: string;
  readonly rerunResult: RerunResult | null;
  readonly closureEvidence: readonly string[];
}

export type FailureLedger =
  | { readonly status: 'zero-failures'; readonly failures: readonly [] }
  | { readonly status: 'current-failures'; readonly failures: readonly [FailureLedgerRow, ...FailureLedgerRow[]] };

const rerunResultFields = ['suiteCommand', 'exitCode', 'observedAt'];
const rowFields = [
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  optionalFields: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  const allowedFields = [...fields, ...optionalFields];
  return fields.every((field) => Object.hasOwn(value, field)) && keys.every((key) => allowedFields.includes(key));
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

function isExitCode(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isObservedAt(value: unknown): value is string {
  return nonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function isPopulatedRerunResult(value: RerunResult | null): value is RerunResult {
  return value !== null;
}

function validateRerunResult(value: unknown): value is RerunResult {
  if (!isRecord(value) || !hasExactFields(value, rerunResultFields, ['firstError'])) return false;
  if (!nonEmptyString(value.suiteCommand) || !isExitCode(value.exitCode) || !isObservedAt(value.observedAt)) {
    return false;
  }
  return !Object.hasOwn(value, 'firstError') || nonEmptyString(value.firstError);
}

function validateClosureEvidence(value: unknown): value is readonly string[] {
  return isDenseArray(value) && value.every(nonEmptyString);
}

function validateRow(value: unknown): value is FailureLedgerRow {
  if (!isRecord(value) || !hasExactFields(value, rowFields)) return false;
  if (
    !nonEmptyString(value.id) ||
    !nonEmptyString(value.suiteCommand) ||
    !isExitCode(value.suiteExitCode) ||
    !nonEmptyString(value.firstError) ||
    !nonEmptyString(value.contractRef) ||
    !nonEmptyString(value.owner) ||
    !nonEmptyString(value.rerunCommand) ||
    !(value.rerunResult === null || validateRerunResult(value.rerunResult)) ||
    !validateClosureEvidence(value.closureEvidence)
  ) {
    return false;
  }
  return isPopulatedRerunResult(value.rerunResult) || value.closureEvidence.length > 0;
}

export function validateFailureLedger(value: unknown): FailureLedger {
  if (!isRecord(value) || !hasExactFields(value, ['status', 'failures'])) {
    throw new TypeError('Failure ledger must be a tagged object');
  }
  if (!isDenseArray(value.failures)) throw new TypeError('Failure ledger failures must be a dense array');

  if (value.status === 'zero-failures') {
    if (value.failures.length !== 0) throw new TypeError('Zero-failures ledger must contain no failures');
    return value as FailureLedger;
  }
  if (value.status !== 'current-failures' || value.failures.length === 0) {
    throw new TypeError('Current-failures ledger must contain at least one failure');
  }

  const ids = new Set<string>();
  for (const item of value.failures) {
    if (!validateRow(item)) throw new TypeError('Malformed current failure row');
    if (ids.has(item.id)) throw new TypeError(`Duplicate failure id: ${item.id}`);
    ids.add(item.id);
  }
  return value as FailureLedger;
}

export function isFailureLedger(value: unknown): value is FailureLedger {
  try {
    validateFailureLedger(value);
    return true;
  } catch {
    return false;
  }
}
