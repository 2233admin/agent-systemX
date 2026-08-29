import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ConfigurationRevision } from '../../domain/configuration';
import { defaultDbPath } from '../../cli/db-path';
import AGENT_STATUS_EXTENSION_MODULE from './extensions/agent-status-extension.ts' with { type: 'text' };

const AGENT_STATUS_EXTENSION_SOURCE = AGENT_STATUS_EXTENSION_MODULE as unknown as string;

export const DENYLISTED_FORWARDED_ARG_TOKENS: readonly string[] = [
  '-e', '--extension', '--profile', '-c', '--continue', '-r', '--resume', '--session-dir',
];

export function findDenylistedForwardedArg(forwardedArgs: readonly string[]): string | null {
  for (const arg of forwardedArgs) {
    const token = arg.split('=', 1)[0] ?? '';
    if (DENYLISTED_FORWARDED_ARG_TOKENS.includes(token)) return arg;
  }
  return null;
}

export function buildOmpArgv(
  revision: ConfigurationRevision,
  launchContextPath: string,
  extensionPath: string | null,
  forwardedArgs: readonly string[],
): readonly string[] {
  void launchContextPath;
  const denied = findDenylistedForwardedArg(forwardedArgs);
  if (denied !== null) throw new Error(`forwarded argument is reserved by Agent System: ${denied}`);
  const argv: string[] = [];
  if (extensionPath !== null) argv.push('--no-extensions', '-e', extensionPath);
  const skills = revision.capabilities.filter((capability) => capability.kind === 'skill').map((capability) => capability.name);
  argv.push(skills.length === 0 ? '--no-skills' : '--skills', ...(skills.length === 0 ? [] : [skills.join(',')]));
  argv.push(...forwardedArgs);
  return argv;
}

export function defaultExtensionPath(): string {
  const directory = path.join(path.dirname(defaultDbPath()), 'extensions');
  mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, 'agent-status-extension.ts');
  writeFileSync(filePath, AGENT_STATUS_EXTENSION_SOURCE, 'utf8');
  return filePath;
}
