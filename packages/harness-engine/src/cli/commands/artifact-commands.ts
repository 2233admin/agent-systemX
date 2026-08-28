import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { canonicalHashFor } from '../../artifacts/canonical.ts';
import { migrateArtifact } from '../../artifacts/migration.ts';
import { resolveHarnessPath } from '../../artifacts/paths.ts';
import { inspectArtifactSchema } from '../../artifacts/status-schema.ts';
import { doctor } from '../../artifacts/doctor.ts';
import { registerProject } from '../../artifacts/project-register.ts';
import { parseArtifactCommand, type ArtifactCommand } from '../parsers/artifact-commands.ts';

export interface ArtifactCommandResult {
  readonly command: ArtifactCommand['command'];
  readonly result: 'pass' | 'invalid' | 'unknown' | 'not-available';
  readonly value?: unknown;
  readonly violations: readonly { readonly code: string }[];
}

function invalid(command: ArtifactCommand['command'], code: string): ArtifactCommandResult {
  return { command, result: 'invalid', violations: [{ code }] };
}

export async function runArtifactCommand(args: readonly string[]): Promise<ArtifactCommandResult> {
  let command: ArtifactCommand;
  try { command = parseArtifactCommand(args); } catch { return invalid('status', 'artifact.command.invalid'); }
  try {
    if (command.command === 'path') return { command: 'path', result: 'pass', value: resolveHarnessPath(command.root, command.workflowId), violations: [] };
    if (command.command === 'project-register') {
      const value = await registerProject(command.root, command.workflowId, command.projectId, 0);
      return { command: 'project-register', result: 'pass', value, violations: [] };
    }
    if (command.command === 'status') {
      const resolution = resolveHarnessPath(command.root, command.workflowId);
      let raw: string;
      try { raw = await readFile(resolution.artifactPath, 'utf8'); }
      catch { return { command: 'status', result: 'unknown', violations: [{ code: 'artifact.status.unavailable' }] }; }
      return { command: 'status', result: 'pass', value: inspectArtifactSchema(JSON.parse(raw) as unknown), violations: [] };
    }
    if (command.command === 'doctor') {
      const value = await doctor(command.root, command.workflowId);
      return { command: 'doctor', result: value.result, value, violations: [] };
    }
    if (command.command !== 'migrate') return invalid(command.command, 'artifact.command.invalid');
    const source = JSON.parse(await readFile(command.source, 'utf8')) as unknown;
    const migrated = migrateArtifact(source);
    const targetPath = `${resolveHarnessPath(command.root, command.workflowId).root}/migrations/${command.workflowId}.v2.json`;
    await mkdir(dirname(targetPath), { recursive: true });
    try { await writeFile(targetPath, `${JSON.stringify(migrated.value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    return { command: 'migrate', result: 'pass', value: { ...migrated, targetDigest: canonicalHashFor(migrated.value) }, violations: [] };
  } catch (error) {
    const invalidInput = error instanceof TypeError;
    return { command: command.command, result: invalidInput ? 'invalid' : 'unknown', violations: [{ code: `artifact.${command.command}.${invalidInput ? 'invalid' : 'unknown'}` }] };
  }
}

export function formatArtifactCommandResult(result: ArtifactCommandResult): string {
  return `${JSON.stringify(result)}\n`;
}
