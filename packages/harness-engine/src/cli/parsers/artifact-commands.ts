export type ArtifactCommand =
  | { readonly command: 'path' | 'status' | 'doctor'; readonly root: string; readonly workflowId: string }
  | { readonly command: 'project-register'; readonly root: string; readonly workflowId: string; readonly projectId: string }
  | { readonly command: 'migrate'; readonly root: string; readonly workflowId: string; readonly source: string };

function value(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

function exactlyOnce(args: readonly string[], flag: string): boolean {
  return args.filter((item) => item === flag).length === 1;
}

export function parseArtifactCommand(args: readonly string[]): ArtifactCommand {
  const command = args[1];
  const root = value(args, '--root');
  const workflowId = value(args, '--workflow-id');
  if ((command === 'path' || command === 'status' || command === 'doctor') && root !== undefined && workflowId !== undefined
    && exactlyOnce(args, '--root') && exactlyOnce(args, '--workflow-id') && args.at(-1) === '--json' && args.length === 7) {
    return { command, root, workflowId };
  }
  if (command === 'project' && args[2] === 'register') {
    const projectId = value(args, '--project-id');
    if (root !== undefined && workflowId !== undefined && projectId !== undefined && exactlyOnce(args, '--root')
      && exactlyOnce(args, '--workflow-id') && exactlyOnce(args, '--project-id') && args.at(-1) === '--json' && args.length === 9) {
      return { command: 'project-register', root, workflowId, projectId };
    }
  }
  if (command === 'migrate') {
    const source = value(args, '--source');
    if (root !== undefined && workflowId !== undefined && source !== undefined && exactlyOnce(args, '--root')
      && exactlyOnce(args, '--workflow-id') && exactlyOnce(args, '--source') && args.at(-1) === '--json' && args.length === 9) {
      return { command, root, workflowId, source };
    }
  }
  throw new TypeError('invalid artifact command');
}
