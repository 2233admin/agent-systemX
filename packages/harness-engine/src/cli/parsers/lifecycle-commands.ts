export type LifecycleCommand =
  | { readonly command: 'host-doctor'; readonly host: string; readonly version: string }
  | { readonly command: 'release-verify'; readonly artifact: string; readonly platform: string }
  | { readonly command: 'knowledge-check'; readonly source: string }
  | { readonly command: 'observation-status'; readonly workflowId: string };

function value(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

export function parseLifecycleCommand(args: readonly string[]): LifecycleCommand {
  if (args.at(-1) !== '--json') throw new TypeError('lifecycle command requires --json');
  if (args[0] === 'host' && args[1] === 'doctor') {
    const host = value(args, '--host'); const version = value(args, '--version');
    if (host !== undefined && version !== undefined && args.length === 7) return { command: 'host-doctor', host, version };
  }
  if (args[0] === 'release' && args[1] === 'verify') {
    const artifact = value(args, '--artifact'); const platform = value(args, '--platform');
    if (artifact !== undefined && platform !== undefined && args.length === 7) return { command: 'release-verify', artifact, platform };
  }
  if (args[0] === 'knowledge' && args[1] === 'check') {
    const source = value(args, '--source');
    if (source !== undefined && args.length === 5) return { command: 'knowledge-check', source };
  }
  if (args[0] === 'observation' && args[1] === 'status') {
    const workflowId = value(args, '--workflow-id');
    if (workflowId !== undefined && args.length === 5) return { command: 'observation-status', workflowId };
  }
  throw new TypeError('invalid lifecycle command');
}
