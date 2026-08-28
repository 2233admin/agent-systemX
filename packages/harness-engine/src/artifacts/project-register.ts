import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveHarnessPath } from './paths.ts';

export interface ProjectRecord {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly workflowId: string;
  readonly projectId: string;
  readonly registeredAt: string;
}

export async function registerProject(root: string, workflowId: string, projectId: string, expectedRevision: number): Promise<ProjectRecord> {
  const resolution = resolveHarnessPath(root, workflowId);
  if (typeof projectId !== 'string' || projectId.trim().length === 0 || /[\\/]/.test(projectId)) throw new TypeError('projectId must be a path-safe identifier');
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== 0) throw new Error('project registration requires expected revision 0');
  const projectRoot = join(resolution.root, 'projects', workflowId);
  const projectPath = join(projectRoot, `${projectId}.json`);
  const record: ProjectRecord = { schemaVersion: 1, revision: 1, workflowId, projectId, registeredAt: resolution.observedAt };
  await mkdir(projectRoot, { recursive: true });
  try {
    await writeFile(projectPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('project revision conflict');
    throw error;
  }
  return record;
}
