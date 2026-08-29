import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ClientAdapter, ClientAdapterInput, ClientAdapterRegistry, ClientCapability, ObservedLaunch, ObservedText, PreparedActivation, StartedProcess } from '../../application/ports/client-adapter';
import type { ConfigurationRevision } from '../../domain/configuration';
import { clientId, type ClientId } from '../../domain/client';
import { defaultDbPath } from '../../cli/db-path';
import { buildOmpArgv, defaultExtensionPath } from '../omp/process-port';
import { FsClaudeContentMaterializer, type ClaudeContentMaterializationResult } from './claude/content-materializer';

function known(value: string): ObservedText {
  return { kind: 'known', value };
}

function unknown(reason: string): ObservedText {
  return { kind: 'unknown', reason, observedAt: new Date().toISOString() };
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeErrorCode(prefix: string): string {
  return prefix;
}
function helpHasFlag(help: string, flag: string): boolean {
  return help.split(/\s+/u).some((token) => token === flag || token.startsWith(`${flag}=`) || token.startsWith(`${flag},`));
}

async function readPipe(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  return stream === null ? '' : new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

async function runVersion(binary: string): Promise<{ readonly output: string; readonly exitCode: number }> {
  const executable = Bun.which(binary);
  if (executable === null) throw new Error(`${binary}-binary-not-found`);
  const process = Bun.spawn([executable, '--version'], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([readPipe(process.stdout), readPipe(process.stderr), process.exited]);
  return { output: (stdout || stderr).trim(), exitCode };
}

async function runHelp(binary: string): Promise<string> {
  const executable = Bun.which(binary);
  if (executable === null) throw new Error(`${binary}-binary-not-found`);
  const process = Bun.spawn([executable, '--help'], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([readPipe(process.stdout), readPipe(process.stderr), process.exited]);
  if (exitCode !== 0) throw new Error(`${binary}-help-exited-${exitCode}`);
  return `${stdout}\n${stderr}`;
}

abstract class IsolatedClientAdapter implements ClientAdapter {
  abstract readonly clientId: ClientId;
  protected abstract readonly binary: string;
  protected abstract requiredFlags(revision: ConfigurationRevision): readonly string[];
  protected abstract prepareContext(input: ClientAdapterInput): Promise<Record<string, unknown>>;
  protected abstract buildArgv(input: ClientAdapterInput, context: Record<string, unknown>): readonly string[];
  protected abstract spawnOptions(context: Record<string, unknown>): { readonly cwd: string; readonly env: Record<string, string | undefined> };
  protected abstract cleanup(context: Record<string, unknown>): Promise<void>;

  async probe(input?: { readonly revision: ConfigurationRevision }): Promise<ClientCapability> {
    try {
      const version = await runVersion(this.binary);
      if (version.exitCode !== 0 || version.output.length === 0) return { level: 'unknown', version: unknown(`${this.binary}-version-unavailable`), reason: `${this.binary}-version-unavailable` };
      const help = await runHelp(this.binary);
      const missing = input === undefined ? [] : this.requiredFlags(input.revision).filter((flag) => !helpHasFlag(help, flag));
      if (missing.length > 0) return { level: 'unsupported', version: known(version.output), reason: `${this.binary}-required-flags-missing:${missing.join(',')}` };
      return { level: 'supported', version: known(version.output), reason: undefined };
    } catch {
      return { level: 'unknown', version: unknown(safeErrorCode(`${this.binary}-probe-failed`)), reason: safeErrorCode(`${this.binary}-probe-failed`) };
    }
  }

  async prepare(input: ClientAdapterInput): Promise<PreparedActivation> {
    const context = await this.prepareContext(input);
    return { manifestHash: hash({ clientId: this.clientId, revision: input.revision, context }), context };
  }

  async start(input: ClientAdapterInput & { readonly prepared: PreparedActivation }): Promise<StartedProcess> {
    const context = input.prepared.context;
    try {
      const executable = Bun.which(this.binary);
      if (executable === null) throw new Error(`${this.binary}-binary-not-found`);
      const options = this.spawnOptions(context);
      const child = Bun.spawn([executable, ...this.buildArgv(input, context)], {
        cwd: options.cwd,
        env: options.env,
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
      });
      const waitForExit = child.exited.then((exitCode) => ({ exitCode, signal: child.signalCode }));
      return { processReference: { pid: child.pid, token: `${this.clientId}:${hash(input.operationId).slice(0, 32)}` }, exitCode: null, signal: null, context, terminate: async () => { child.kill(); }, waitForExit };
    } catch (error) {
      try { await this.cleanup(context); } catch { }
      throw error;
    }
  }
  async abort(input: ClientAdapterInput & { readonly prepared: PreparedActivation; readonly started?: StartedProcess }): Promise<void> {
    if (input.started?.terminate !== undefined) await input.started.terminate();
    await this.cleanup(input.started?.context ?? input.prepared.context);
  }
  async observe(input: ClientAdapterInput & { readonly started: StartedProcess }): Promise<ObservedLaunch> {
    try {
      const exit = input.started.waitForExit === undefined ? { exitCode: input.started.exitCode, signal: input.started.signal } : await input.started.waitForExit;
      if (exit.exitCode === 0) return { outcome: 'succeeded', reason: undefined };
      if (exit.signal !== null) return { outcome: 'incomplete', reason: `${this.binary}-signal-${exit.signal}` };
      if (exit.exitCode !== null) return { outcome: 'failed', reason: `${this.binary}-exit-${exit.exitCode}` };
      return { outcome: 'unknown', reason: `${this.binary}-exit-unobserved` };
    } finally {
      try { await this.cleanup(input.started.context ?? {}); } catch { }
    }
  }
}

export class OmpClientAdapter extends IsolatedClientAdapter {
  readonly clientId = clientId('omp');
  protected readonly binary = 'omp';
  protected requiredFlags(revision: ConfigurationRevision): readonly string[] {
    const flags = ['--no-skills'];
    if (revision.capabilities.some((capability) => capability.kind === 'skill')) flags.push('--skills');
    return flags;
  }
  protected async prepareContext(input: ClientAdapterInput): Promise<Record<string, unknown>> {
    const directory = path.join(path.dirname(defaultDbPath()), 'launch-context');
    await mkdir(directory, { recursive: true });
    const contextPath = path.join(directory, `${hash(input.operationId).slice(0, 32)}.json`);
    const extensionPath = defaultExtensionPath();
    await writeFile(contextPath, JSON.stringify({ version: 1, operationId: input.operationId, revisionId: input.revision.revisionId, configName: input.revision.configName, client: this.clientId }, null, 2));
    return { cwd: process.cwd(), contextPath, extensionPath };
  }
  protected buildArgv(input: ClientAdapterInput, context: Record<string, unknown>): readonly string[] {
    return buildOmpArgv(input.revision, String(context.contextPath), String(context.extensionPath), input.forwardedArgs ?? []);
  }
  protected spawnOptions(context: Record<string, unknown>): { readonly cwd: string; readonly env: Record<string, string | undefined> } {
    return { cwd: String(context.cwd), env: { ...process.env, AGENT_SYSTEM_LAUNCH_CONTEXT: String(context.contextPath) } };
  }
  protected async cleanup(context: Record<string, unknown>): Promise<void> {
    if (typeof context.contextPath === 'string') await rm(context.contextPath, { force: true });
  }
}

export class ClaudeClientAdapter extends IsolatedClientAdapter {
  readonly clientId = clientId('claude-code');
  protected readonly binary = 'claude';
  private readonly materializer = new FsClaudeContentMaterializer();
  protected requiredFlags(revision: ConfigurationRevision): readonly string[] {
    const flags: string[] = [];
    if (revision.capabilities.some((capability) => capability.kind === 'instruction')) flags.push('--append-system-prompt');
    if (revision.capabilities.some((capability) => capability.kind === 'skill')) flags.push('--plugin-dir');
    if (revision.capabilities.some((capability) => capability.kind === 'mcp')) flags.push('--mcp-config', '--strict-mcp-config');
    return flags;
  }
  protected async prepareContext(input: ClientAdapterInput): Promise<Record<string, unknown>> {
    const invocationDir = await mkdtemp(path.join(path.dirname(defaultDbPath()), 'claude-invocation-'));
    try {
      const materialization = await this.materializer.materialize(input.revision, invocationDir);
      const failures = [...materialization.instructions.failures, ...materialization.skills.failures, ...materialization.mcp.failures];
      if (failures.length > 0) throw new Error(`content-materialization-failed:${failures.map((failure) => failure.name).join(',')}`);
      return { invocationDir, materialization };
    } catch (error) {
      await rm(invocationDir, { recursive: true, force: true });
      throw error;
    }
  }
  protected buildArgv(input: ClientAdapterInput, context: Record<string, unknown>): readonly string[] {
    const materialization = context.materialization as ClaudeContentMaterializationResult;
    const argv: string[] = [];
    if (materialization.instructions.appendSystemPromptText !== null) argv.push('--append-system-prompt', materialization.instructions.appendSystemPromptText);
    if (materialization.skills.pluginDirPath !== null) argv.push('--plugin-dir', materialization.skills.pluginDirPath);
    if (materialization.mcp.mcpConfigPath !== null) argv.push('--mcp-config', materialization.mcp.mcpConfigPath, '--strict-mcp-config');
    argv.push(...(input.forwardedArgs ?? []));
    return argv;
  }
  protected spawnOptions(context: Record<string, unknown>): { readonly cwd: string; readonly env: Record<string, string | undefined> } {
    const invocationDir = String(context.invocationDir);
    return { cwd: invocationDir, env: { ...process.env, CLAUDE_CONFIG_DIR: invocationDir } };
  }
  protected async cleanup(context: Record<string, unknown>): Promise<void> {
    if (typeof context.invocationDir === 'string') await rm(context.invocationDir, { recursive: true, force: true });
  }
}

export class InMemoryClientAdapterRegistry implements ClientAdapterRegistry {
  private readonly adapters = new Map<ClientId, ClientAdapter>();
  constructor(adapters: readonly ClientAdapter[] = [new OmpClientAdapter(), new ClaudeClientAdapter()]) {
    for (const adapter of adapters) this.adapters.set(adapter.clientId, adapter);
  }
  get(clientIdValue: ClientId): ClientAdapter | null {
    return this.adapters.get(clientIdValue) ?? null;
  }
}
