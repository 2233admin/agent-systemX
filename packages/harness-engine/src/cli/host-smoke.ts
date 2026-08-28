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

export async function runHostSmoke(facade: ControlPlaneFacade, input: HostSmokeInput): Promise<HostSmokeResult | CapabilityResult> {
  if (input.revisionId === undefined || input.revisionId.trim().length === 0) {
    return { host: input.host, result: 'not-available', reasonCode: 'HARNESS_HOST_REVISION_ID.missing', scope: 'read-only' };
  }
  const adapter = input.host === 'omp'
    ? new OmpHostAdapter(facade, input.revisionId)
    : new ClaudeHostAdapter(facade, input.revisionId);
  return adapter.probe({ hostId: input.host, hostVersion: input.hostVersion ?? 'unknown' });
}

if (import.meta.main) {
  process.env.HARNESS_REAL_WRITE = '0';
  const host = process.argv[process.argv.indexOf('--host') + 1];
  const revisionId = process.argv[process.argv.indexOf('--revision-id') + 1] ?? process.env.HARNESS_HOST_REVISION_ID;
  if (host !== 'omp' && host !== 'claude') {
    process.stdout.write(JSON.stringify({ result: 'not-available', reasonCode: 'host.invalid', scope: 'read-only' }) + '\n');
  } else if (revisionId === undefined || revisionId.trim().length === 0) {
    process.stdout.write(JSON.stringify({ host, result: 'not-available', reasonCode: 'HARNESS_HOST_REVISION_ID.missing', scope: 'read-only' }) + '\n');
  } else {
    const facade = await createProductionHarnessControlPlaneFacade();
    const result = await runHostSmoke(facade, { host, revisionId, hostVersion: process.env.HARNESS_HOST_VERSION });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}
