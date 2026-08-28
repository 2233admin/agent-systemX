import type { CapabilityResult, HostAdapter, HostAssignment, HostContext, HostObservation, HostOperation } from '../../ports/host.ts';
import { validateCapabilityResult } from '../../ports/host.ts';
import type { ControlledTransport } from '../contracts.ts';

export class ControlledHostAdapter implements HostAdapter {
  public constructor(private readonly transport: ControlledTransport<HostContext | HostAssignment | HostOperation | HostObservation, unknown>) {}

  public async probe(hostContext: HostContext): Promise<CapabilityResult> {
    return this.read(hostContext);
  }

  public async prepare(assignment: HostAssignment): Promise<CapabilityResult> {
    return this.read(assignment);
  }

  public async observe(operation: HostOperation): Promise<CapabilityResult> {
    return this.read(operation);
  }

  public async interpret(observation: HostObservation): Promise<CapabilityResult> {
    return this.read(observation);
  }

  private async read(input: HostContext | HostAssignment | HostOperation | HostObservation): Promise<CapabilityResult> {
    try {
      const value = validateCapabilityResult(await this.transport.request(input));
      return value;
    } catch {
      return {
        status: 'unknown',
        hostId: input.hostId,
        hostVersion: input.hostVersion,
        reasonCode: 'host.response.unavailable',
      };
    }
  }
}

export type OmpHostAdapter = ControlledHostAdapter;
export type ClaudeHostAdapter = ControlledHostAdapter;
export type CodexHostAdapter = ControlledHostAdapter;
export type OpencodeHostAdapter = ControlledHostAdapter;
