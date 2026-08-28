import type { EvidenceRef } from '../core/result.ts';
import { isRfc3339Timestamp } from '../core/result.ts';
import type { AdapterCorrelationEnvelope } from '../adapters/contracts.ts';

export interface RealSmokeEvidence {
  readonly backend: 'orca' | 'github';
  readonly adapterVersion: string;
  readonly observedAt: string;
  readonly objectRefs: readonly string[];
  readonly permission: 'read-only' | 'bounded-write' | 'denied' | 'unknown';
  readonly network: 'reachable' | 'unreachable' | 'unknown';
  readonly expectedHead?: string;
  readonly readbackRefs: readonly string[];
  readonly result: 'pass' | 'blocked' | 'unknown' | 'not-available';
  readonly scope: 'read-only';
  readonly currentHead?: string;
  readonly sourceHash?: string;
  readonly correlation: AdapterCorrelationEnvelope;
  readonly missing?: readonly string[];
}

export interface RealSmokeInput {
  readonly backend: 'orca' | 'github';
  readonly adapterVersion: string;
  readonly correlation: AdapterCorrelationEnvelope;
  readonly requiredEnv: readonly string[];
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly read: () => Promise<Pick<RealSmokeEvidence, 'objectRefs' | 'permission' | 'network' | 'readbackRefs' | 'result'>>;
}

const SENSITIVE = /\b(?:prompt|transcript|credential|password|secret|token|stderr)\b|tool[\s_-]*payload/i;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeStrings(value: unknown, field: string): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => nonEmpty(item) && !SENSITIVE.test(item));
}

function containsSensitive(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => typeof item === 'string' && SENSITIVE.test(item));
}

export function validateRealSmokeEvidence(value: unknown): RealSmokeEvidence {
  if (record(value) && (containsSensitive(value.objectRefs) || containsSensitive(value.readbackRefs))) {
    throw new TypeError('RealSmokeEvidence sensitive content is prohibited');
  }
  if (!record(value) || value.scope !== 'read-only' || (value.backend !== 'orca' && value.backend !== 'github')
    || !nonEmpty(value.adapterVersion) || typeof value.observedAt !== 'string' || !isRfc3339Timestamp(value.observedAt)
    || !safeStrings(value.objectRefs, 'objectRefs') || !safeStrings(value.readbackRefs, 'readbackRefs')
    || !['read-only', 'bounded-write', 'denied', 'unknown'].includes(String(value.permission))
    || !['reachable', 'unreachable', 'unknown'].includes(String(value.network))
    || !['pass', 'blocked', 'unknown', 'not-available'].includes(String(value.result))
    || !record(value.correlation)) {
    throw new TypeError('RealSmokeEvidence requires a redacted read-only evidence shape');
  }
  if (value.expectedHead !== undefined && !nonEmpty(value.expectedHead)) throw new TypeError('RealSmokeEvidence expectedHead must be non-empty');
  if (value.currentHead !== undefined && !nonEmpty(value.currentHead)) throw new TypeError('RealSmokeEvidence currentHead must be non-empty');
  if (value.sourceHash !== undefined && !nonEmpty(value.sourceHash)) throw new TypeError('RealSmokeEvidence sourceHash must be non-empty');
  if (value.missing !== undefined && !safeStrings(value.missing, 'missing')) throw new TypeError('RealSmokeEvidence missing must be safe strings');
  return value as unknown as RealSmokeEvidence;
}

export async function collectRealSmokeEvidence(input: RealSmokeInput): Promise<RealSmokeEvidence> {
  const missing = input.requiredEnv.filter((name) => !nonEmpty(input.environment[name]));
  if (missing.length > 0) {
    return validateRealSmokeEvidence({
      backend: input.backend,
      adapterVersion: input.adapterVersion,
      observedAt: input.correlation.observedAt,
      objectRefs: [],
      permission: 'read-only',
      network: 'unknown',
      readbackRefs: [],
      result: 'not-available',
      scope: 'read-only',
      correlation: input.correlation,
      missing,
    });
  }
  const readback = await input.read();
  return validateRealSmokeEvidence({
    ...readback,
    backend: input.backend,
    adapterVersion: input.adapterVersion,
    observedAt: input.correlation.observedAt,
    scope: 'read-only',
    correlation: input.correlation,
  });
}

export interface ReadOnlyProcessResult {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdoutSummary: string;
  readonly stderrSummary: string;
}

function summary(value: string): string {
  if (SENSITIVE.test(value)) return '[redacted]';
  return value.length > 2000 ? `${value.slice(0, 2000)}[truncated]` : value;
}

export async function runReadOnlyProcess(
  argv: readonly string[],
  options: { readonly cwd?: string; readonly timeoutMs?: number; readonly env?: Record<string, string | undefined> } = {},
): Promise<ReadOnlyProcessResult> {
  if (argv.length === 0 || argv.some((argument) => argument.length === 0)) throw new TypeError('Read-only process argv must be non-empty');
  const child = Bun.spawn([...argv], {
    cwd: options.cwd,
    env: { ...options.env, HARNESS_REAL_WRITE: '0' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const timeoutMs = options.timeoutMs ?? 30_000;
  const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs));
  const exited = child.exited.then((exitCode) => ({ exitCode, timedOut: false as const }));
  const outcome = await Promise.race([exited, timeout]);
  if (outcome === 'timeout') {
    child.kill('SIGTERM');
    return { exitCode: null, timedOut: true, stdoutSummary: summary(await new Response(child.stdout).text()), stderrSummary: summary(await new Response(child.stderr).text()) };
  }
  return {
    exitCode: outcome.exitCode,
    timedOut: outcome.timedOut,
    stdoutSummary: summary(await new Response(child.stdout).text()),
    stderrSummary: summary(await new Response(child.stderr).text()),
  };
}

export function normalizeWindowsPath(value: string): string {
  if (!nonEmpty(value)) throw new TypeError('Windows path must be non-empty');
  const normalized = value.replaceAll('\\', '/');
  const prefix = /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//') ? normalized.slice(0, normalized.indexOf('/') + 1) : '';
  const parts = normalized.slice(prefix.length).split('/');
  let depth = 0;
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (depth === 0) throw new Error('Windows path escape is not allowed');
      depth -= 1;
    } else depth += 1;
  }
  return `${prefix}${parts.filter((part) => part !== '' && part !== '.').join('/')}`;
}

export function evidenceRefForSmoke(evidence: RealSmokeEvidence, locator: string): EvidenceRef {
  if (!nonEmpty(locator) || SENSITIVE.test(locator)) throw new TypeError('Smoke evidence locator must be redacted');
  return { source: `real-smoke.${evidence.backend}`, observedAt: evidence.observedAt, locator };
}
