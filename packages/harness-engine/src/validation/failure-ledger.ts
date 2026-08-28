import { isRfc3339Timestamp } from '../core/result.ts';

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
  | {
      readonly status: 'zero-failures';
      readonly failures: readonly [];
      readonly currentHead: string;
      readonly commandsEvidence: CommandsEvidence;
    }
  | {
      readonly status: 'current-failures';
      readonly failures: readonly [FailureLedgerRow, ...FailureLedgerRow[]];
      readonly currentHead: string;
      readonly commandsEvidence: CommandsEvidence;
    };

export interface OwnershipRecord {
  readonly currentHead: string;
  readonly branch: string;
  readonly worktree: string;
  readonly ownedPaths: readonly string[];
  readonly attributedDirtyPaths: readonly string[];
  readonly untrackedPaths: readonly string[];
  readonly conflictingPaths: readonly string[];
  readonly implementer: string;
  readonly observedAt: string;
}

export interface CommandEvidence {
  readonly name: string;
  readonly command: string;
  readonly exitCode: number;
  readonly output: string;
  readonly observedAt: string;
}

export interface CommandsEvidence {
  readonly currentHead: string;
  readonly branch: string;
  readonly worktree: string;
  readonly commands: readonly [CommandEvidence, ...CommandEvidence[]];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
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

function validateStringArray(value: unknown, field: string): readonly string[] {
  if (!isDenseArray(value) || value.some((item) => !nonEmptyString(item))) {
    throw new TypeError(`${field} must be a dense array of non-empty strings`);
  }
  const values = value as readonly string[];
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${field} must not contain duplicate values`);
  }
  return values;
}

function validateExitCode(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(`${field} must be an integer exit code`);
  }
  return value;
}

function validateObservedAt(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isRfc3339Timestamp(value)) {
    throw new TypeError(`${field} must be an RFC 3339 timestamp`);
  }
  return value;
}

function validateRerunResult(value: unknown): RerunResult {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['suiteCommand', 'exitCode', 'firstError', 'observedAt'])
    || !hasOwn(value, 'suiteCommand')
    || !hasOwn(value, 'exitCode')
    || !hasOwn(value, 'observedAt')
    || !nonEmptyString(value.suiteCommand)) {
    throw new TypeError('RerunResult requires suiteCommand, exitCode, and observedAt');
  }
  validateExitCode(value.exitCode, 'RerunResult exitCode');
  validateObservedAt(value.observedAt, 'RerunResult observedAt');
  if (hasOwn(value, 'firstError') && !nonEmptyString(value.firstError)) {
    throw new TypeError('RerunResult firstError must be non-empty when present');
  }
  return value as unknown as RerunResult;
}

function validateFailureLedgerRow(value: unknown): FailureLedgerRow {
  const keys = [
    'id', 'suiteCommand', 'suiteExitCode', 'firstError', 'contractRef',
    'owner', 'rerunCommand', 'rerunResult', 'closureEvidence',
  ] as const;
  if (!isRecord(value)
    || !hasOnlyKeys(value, keys)
    || keys.some((key) => !hasOwn(value, key))
    || !nonEmptyString(value.id)
    || !nonEmptyString(value.suiteCommand)
    || !nonEmptyString(value.firstError)
    || !nonEmptyString(value.contractRef)
    || !nonEmptyString(value.owner)
    || !nonEmptyString(value.rerunCommand)) {
    throw new TypeError('FailureLedger row requires all identity, error, owner, and rerun fields');
  }
  validateExitCode(value.suiteExitCode, 'FailureLedger suiteExitCode');
  const closureEvidence = validateStringArray(value.closureEvidence, 'FailureLedger closureEvidence');
  if (value.rerunResult !== null) validateRerunResult(value.rerunResult);
  if (value.rerunResult === null && closureEvidence.length === 0) {
    throw new TypeError('FailureLedger row requires rerunResult or closureEvidence');
  }
  return value as unknown as FailureLedgerRow;
}

export function validateFailureLedger(value: unknown): FailureLedger {
  const keys = ['status', 'failures', 'currentHead', 'commandsEvidence'] as const;
  if (!isRecord(value)
    || !hasOnlyKeys(value, keys)
    || keys.some((key) => !hasOwn(value, key))
    || (value.status !== 'zero-failures' && value.status !== 'current-failures')
    || !nonEmptyString(value.currentHead)
    || !isDenseArray(value.failures)) {
    throw new TypeError('FailureLedger requires status, currentHead, commandsEvidence, and a dense failures array');
  }
  const commandsEvidence = validateCommandsEvidence(value.commandsEvidence);
  if (commandsEvidence.currentHead !== value.currentHead) {
    throw new TypeError('FailureLedger currentHead must match commandsEvidence currentHead');
  }
  if (value.status === 'zero-failures') {
    if (value.failures.length !== 0) {
      throw new TypeError('zero-failures ledger must have no failures');
    }
    return value as FailureLedger;
  }
  if (value.failures.length === 0) {
    throw new TypeError('current-failures ledger requires at least one failure');
  }
  const ids = new Set<string>();
  for (const row of value.failures) {
    const validated = validateFailureLedgerRow(row);
    if (ids.has(validated.id)) throw new TypeError('FailureLedger row IDs must be unique');
    ids.add(validated.id);
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

export function validateOwnershipRecord(value: unknown): OwnershipRecord {
  const keys = [
    'currentHead', 'branch', 'worktree', 'ownedPaths', 'attributedDirtyPaths',
    'untrackedPaths', 'conflictingPaths', 'implementer', 'observedAt',
  ] as const;
  if (!isRecord(value)
    || !hasOnlyKeys(value, keys)
    || keys.some((key) => !hasOwn(value, key))
    || !nonEmptyString(value.currentHead)
    || !nonEmptyString(value.branch)
    || !nonEmptyString(value.worktree)
    || !nonEmptyString(value.implementer)) {
    throw new TypeError('OwnershipRecord requires identity, path, implementer, and observedAt fields');
  }
  const ownedPaths = validateStringArray(value.ownedPaths, 'OwnershipRecord ownedPaths');
  const attributedDirtyPaths = validateStringArray(value.attributedDirtyPaths, 'OwnershipRecord attributedDirtyPaths');
  const untrackedPaths = validateStringArray(value.untrackedPaths, 'OwnershipRecord untrackedPaths');
  const conflictingPaths = validateStringArray(value.conflictingPaths, 'OwnershipRecord conflictingPaths');
  const owned = new Set(ownedPaths);
  for (const [field, paths] of [
    ['attributedDirtyPaths', attributedDirtyPaths],
    ['untrackedPaths', untrackedPaths],
    ['conflictingPaths', conflictingPaths],
  ] as const) {
    if (paths.some((path) => owned.has(path))) {
      throw new TypeError(`OwnershipRecord ownedPaths must not overlap ${field}`);
    }
  }
  validateObservedAt(value.observedAt, 'OwnershipRecord observedAt');
  return value as unknown as OwnershipRecord;
}

export function isOwnershipRecord(value: unknown): value is OwnershipRecord {
  try {
    validateOwnershipRecord(value);
    return true;
  } catch {
    return false;
  }
}

const SENSITIVE_OUTPUT_PATTERN =
  /\b(?:prompt|transcript|credential|password|secret|token|stderr)\b|tool[\s_-]*payload/i;
const SAFE_OUTPUT_PATTERNS = [
  /^bun test v\d+\.\d+\.\d+(?:\s+\([0-9a-f]+\))?$/i,
  /^\s*\d+\s+(?:pass|fail|skip)$/,
  /^\s*\d+\s+expect\(\)\s+calls$/,
  /^Ran \d+ tests? across \d+ files?\. \[\d+(?:\.\d+)?ms\]$/,
  /^exitCode=-?\d+\s*$/,
  /^\[redacted\](?:\s.*)?$/i,
] as const;

function validateCommandOutput(value: string): void {
  if (SENSITIVE_OUTPUT_PATTERN.test(value)) {
    throw new TypeError('CommandEvidence output contains prohibited sensitive content');
  }
  for (const line of value.split(/\r?\n/)) {
    if (line.length === 0 || SAFE_OUTPUT_PATTERNS.some((pattern) => pattern.test(line))) continue;
    throw new TypeError('CommandEvidence output must match the summary allowlist or [redacted]');
  }
}

export function validateCommandEvidence(value: unknown): CommandEvidence {
  const keys = ['name', 'command', 'exitCode', 'output', 'observedAt'] as const;
  if (!isRecord(value)
    || !hasOnlyKeys(value, keys)
    || keys.some((key) => !hasOwn(value, key))
    || !nonEmptyString(value.name)
    || !nonEmptyString(value.command)
    || typeof value.output !== 'string') {
    throw new TypeError('CommandEvidence requires name, command, output, and observedAt fields');
  }
  validateExitCode(value.exitCode, 'CommandEvidence exitCode');
  validateObservedAt(value.observedAt, 'CommandEvidence observedAt');
  validateCommandOutput(value.output);
  return value as unknown as CommandEvidence;
}

export function validateCommandsEvidence(value: unknown): CommandsEvidence {
  const keys = ['currentHead', 'branch', 'worktree', 'commands'] as const;
  if (!isRecord(value)
    || !hasOnlyKeys(value, keys)
    || keys.some((key) => !hasOwn(value, key))
    || !nonEmptyString(value.currentHead)
    || !nonEmptyString(value.branch)
    || !nonEmptyString(value.worktree)
    || !isDenseArray(value.commands)
    || value.commands.length === 0) {
    throw new TypeError('CommandsEvidence requires identity and at least one command');
  }
  const names = new Set<string>();
  for (const command of value.commands) {
    const validated = validateCommandEvidence(command);
    if (names.has(validated.name)) throw new TypeError('CommandsEvidence command names must be unique');
    names.add(validated.name);
  }
  return value as unknown as CommandsEvidence;
}

export function isCommandsEvidence(value: unknown): value is CommandsEvidence {
  try {
    validateCommandsEvidence(value);
    return true;
  } catch {
    return false;
  }
}
