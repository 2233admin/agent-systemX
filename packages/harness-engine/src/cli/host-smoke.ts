import { createProductionHarnessControlPlaneFacade } from '@agent-system/control-plane/application/public-entry';
import type { CapabilityResult } from '../ports/host.ts';
import type { ControlPlaneFacade } from '../application/control-plane-port.ts';
import { ClaudeHostAdapter } from '../adapters/hosts/claude/claude-host-adapter.ts';
import { OmpHostAdapter } from '../adapters/hosts/omp/omp-host-adapter.ts';

export interface HostSmokeInput {
  readonly host: 'omp' | 'claude';
  readonly revisionId?: string;
  readonly hostVersion?: string;
}

export interface HostSmokeResult {
  readonly host: 'omp' | 'claude';
  readonly revisionId?: string;
  readonly result: 'unknown' | 'degraded' | 'not-available';
  readonly reasonCode: string;
  readonly scope: 'read-only';
}

function normalizeOptionalArgument(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  const quoted = (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"));
  const normalized = quoted ? trimmed.slice(1, -1).trim() : trimmed;
  return normalized.length === 0 ? undefined : normalized;
}

function argumentValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return normalizeOptionalArgument(index < 0 ? undefined : args[index + 1]);
}

export async function runHostSmoke(facade: ControlPlaneFacade, input: HostSmokeInput): Promise<HostSmokeResult | CapabilityResult> {
  const revisionId = normalizeOptionalArgument(input.revisionId);
  if (revisionId === undefined) {
    return { host: input.host, result: 'not-available', reasonCode: 'HARNESS_HOST_REVISION_ID.missing', scope: 'read-only' };
  }
  const adapter = input.host === 'omp'
    ? new OmpHostAdapter(facade, revisionId)
    : new ClaudeHostAdapter(facade, revisionId);
  return adapter.probe({ hostId: input.host, hostVersion: normalizeOptionalArgument(input.hostVersion) ?? 'unknown' });
}

if (import.meta.main) {
  process.env.HARNESS_REAL_WRITE = '0';
  const host = argumentValue(process.argv, '--host');
  const revisionId = process.argv.includes('--revision-id')
    ? argumentValue(process.argv, '--revision-id')
    : normalizeOptionalArgument(process.env.HARNESS_HOST_REVISION_ID);
  if (host !== 'omp' && host !== 'claude') {
    process.stdout.write(`${JSON.stringify({ result: 'not-available', reasonCode: 'host.invalid', scope: 'read-only' })}\n`);
  } else if (revisionId === undefined) {
    process.stdout.write(`${JSON.stringify({ host, result: 'not-available', reasonCode: 'HARNESS_HOST_REVISION_ID.missing', scope: 'read-only' })}\n`);
  } else {
    const facade = await createProductionHarnessControlPlaneFacade();
    const result = await runHostSmoke(facade, { host, revisionId, hostVersion: normalizeOptionalArgument(process.env.HARNESS_HOST_VERSION) });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}
