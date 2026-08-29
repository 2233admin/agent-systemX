import { createHash } from 'node:crypto';
import type { ClientAdapter, ClientAdapterInput, ClientCapability, ObservedLaunch, ObservedText, PreparedActivation, StartedProcess } from '../../application/ports/client-adapter';
import type { ConfigurationRevision } from '../../domain/configuration';
import { clientId, type ClientId } from '../../domain/client';

function known(value: string): ObservedText { return { kind: 'known', value }; }
function unknown(reason: string): ObservedText { return { kind: 'unknown', reason, observedAt: new Date().toISOString() }; }
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
async function readProcessOutput(process: { readonly stdout: ReadableStream<Uint8Array> | null; readonly stderr: ReadableStream<Uint8Array> | null }): Promise<string> {
  const stream = process.stdout ?? process.stderr;
  return stream === null ? '' : new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

abstract class BunClientAdapter implements ClientAdapter {
  abstract readonly clientId: ClientId;
  protected abstract readonly binary: string;
  protected abstract buildArgv(input: ClientAdapterInput, prepared: PreparedActivation): readonly string[];

  async probe(): Promise<ClientCapability> {
    const executable = Bun.which(this.binary);
    if (executable === null) return { level: 'unsupported', version: unknown(`${this.binary}-binary-not-found`), reason: `${this.binary} binary was not found` };
    try {
      const process = Bun.spawn([executable, '--version'], { stdout: 'pipe', stderr: 'pipe' });
      const output = (await readProcessOutput(process)).trim();
      const exitCode = await process.exited;
      return exitCode === 0 && output.length > 0 ? { level: 'supported', version: known(output), reason: undefined } : { level: 'unknown', version: unknown(`${this.binary}-version-unavailable`), reason: `${this.binary} version could not be observed` };
    } catch (error) {
      return { level: 'unknown', version: unknown(`${this.binary}-probe-failed`), reason: (error as Error).message };
    }
  }

  async prepare(input: ClientAdapterInput): Promise<PreparedActivation> {
    return { manifestHash: hash({ clientId: this.clientId, revision: input.revision }), context: { operationId: input.operationId, revisionId: input.revision.revisionId, clientId: this.clientId } };
  }

  async start(input: ClientAdapterInput & { readonly prepared: PreparedActivation }): Promise<StartedProcess> {
    const executable = Bun.which(this.binary);
    if (executable === null) throw new Error(`${this.binary} binary was not found`);
    const process = Bun.spawn([...this.buildArgv(input, input.prepared)], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
    const waitForExit = process.exited.then((exitCode) => ({ exitCode, signal: null }));
    return { processReference: { pid: process.pid, token: `${this.clientId}:${input.operationId}` }, exitCode: null, signal: null, waitForExit };
  }

  async observe(input: ClientAdapterInput & { readonly started: StartedProcess }): Promise<ObservedLaunch> {
    const exit = input.started.waitForExit === undefined ? { exitCode: input.started.exitCode, signal: input.started.signal } : await input.started.waitForExit;
    if (exit.exitCode === 0) return { outcome: 'succeeded', reason: undefined };
    if (exit.exitCode !== null) return { outcome: 'failed', reason: `${this.binary} exited with code ${exit.exitCode}` };
    return { outcome: 'unknown', reason: `${this.binary} exit could not be observed` };
  }
}

export class OmpClientAdapter extends BunClientAdapter {
  readonly clientId = clientId('omp');
  protected readonly binary = 'omp';
  protected buildArgv(input: ClientAdapterInput, _prepared: PreparedActivation): readonly string[] {
    const skills = input.revision.capabilities.filter((capability) => capability.kind === 'skill').map((capability) => capability.name);
    return skills.length === 0 ? [this.binary] : [this.binary, '--skills', skills.join(',')];
  }
}

export class ClaudeClientAdapter extends BunClientAdapter {
  readonly clientId = clientId('claude-code');
  protected readonly binary = 'claude';
  protected buildArgv(input: ClientAdapterInput, _prepared: PreparedActivation): readonly string[] {
    const instructions = input.revision.capabilities.filter((capability) => capability.kind === 'instruction').map((capability) => capability.name).join('\n');
    return instructions.length === 0 ? [this.binary] : [this.binary, '--append-system-prompt', instructions];
  }
}

export class InMemoryClientAdapterRegistry {
  private readonly adapters = new Map<ClientId, ClientAdapter>();
  constructor(adapters: readonly ClientAdapter[] = [new OmpClientAdapter(), new ClaudeClientAdapter()]) { for (const adapter of adapters) this.adapters.set(adapter.clientId, adapter); }
  get(clientIdValue: ClientId): ClientAdapter | null { return this.adapters.get(clientIdValue) ?? null; }
}
