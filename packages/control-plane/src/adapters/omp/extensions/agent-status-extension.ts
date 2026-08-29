
interface MinimalExtensionUi {
  notify(message: string, type?: string): void;
  setStatus(key: string, text?: string): void;
}
interface MinimalExtensionContext {
  readonly ui: MinimalExtensionUi;
}

interface MinimalSessionStartEvent {
  readonly type: 'session_start';
}

interface MinimalExtensionAPI {
  on(
    event: 'session_start',
    handler: (
      event: MinimalSessionStartEvent,
      ctx: MinimalExtensionContext,
    ) => void | Promise<void>,
  ): void;
  registerCommand(
    name: string,
    opts: {
      description?: string;
      handler: (args: string[], ctx: MinimalExtensionContext) => void | Promise<void>;
    },
  ): void;
}

/** 对应 control-plane 写入的启动上下文，仅保留扩展展示所需字段。 */
interface LaunchContextFile {
  readonly version: 1;
  readonly operationId: string;
  readonly configName: string;
  readonly revisionId: string;
  readonly client: string;
}

/** 读取一次启动上下文；不轮询、不监听，也不在事件之间重复读取。 */
async function readLaunchContext(): Promise<LaunchContextFile | null> {
  const contextPath = process.env.AGENT_SYSTEM_LAUNCH_CONTEXT;
  if (contextPath === undefined || contextPath.length === 0) {
    return null;
  }
  try {
    const text = await Bun.file(contextPath).text();
    return JSON.parse(text) as LaunchContextFile;
  } catch {
    return null;
  }
}

function formatStatusLine(context: LaunchContextFile | null): string {
  if (context === null) {
    return 'Agent System: launch context unavailable';
  }
  return `Agent System: ${context.configName}@${context.revisionId} [${context.client}]`;
}

function formatDetail(context: LaunchContextFile | null): string {
  if (context === null) {
    return 'Agent System launch context is unavailable (AGENT_SYSTEM_LAUNCH_CONTEXT not set or unreadable).';
  }
  return [
    `configName: ${context.configName}`,
    `revisionId: ${context.revisionId}`,
    `client: ${context.client}`,
    `operationId: ${context.operationId}`,
  ].join('\n');
}

export default function registerAgentStatusExtension(pi: MinimalExtensionAPI): void {
  pi.on('session_start', async (_event, ctx) => {
    const context = await readLaunchContext();
    ctx.ui.setStatus('agent-system-config', formatStatusLine(context));
  });

  pi.registerCommand('agent-config', {
    description: 'Show the Agent System configuration and launch status for this OMP session',
    handler: async (_args, ctx) => {
      const context = await readLaunchContext();
      ctx.ui.notify(formatDetail(context));
    },
  });

  pi.registerCommand('agent-switch-config', {
    description: 'Switch the Agent System configuration (forwards to the external Agent System CLI)',
    handler: async (_args, ctx) => {
      const context = await readLaunchContext();
      const hint = 'run `configs switch <revision-id> --client omp` in the Agent System CLI';
      ctx.ui.notify(`To switch configuration: ${hint}`);
    },
  });
}
