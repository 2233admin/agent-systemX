import { access, readFile } from 'node:fs/promises';
import { resolveHarnessPath } from './paths.ts';

export interface DoctorResult {
  readonly result: 'pass' | 'unknown' | 'not-available';
  readonly root: string;
  readonly workflowId: string;
  readonly reasonCode?: string;
}

export async function doctor(root: string, workflowId: string): Promise<DoctorResult> {
  let resolution;
  try { resolution = resolveHarnessPath(root, workflowId); } catch { return { result: 'unknown', root, workflowId, reasonCode: 'artifact.path.invalid' }; }
  try {
    await access(resolution.root);
    await readFile(resolution.artifactPath, 'utf8');
    return { result: 'pass', root: resolution.root, workflowId };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { result: code === 'ENOENT' ? 'not-available' : 'unknown', root: resolution.root, workflowId, reasonCode: code === 'ENOENT' ? 'artifact.missing' : 'artifact.permission-or-read-failure' };
  }
}
