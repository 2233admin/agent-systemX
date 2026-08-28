import { isRfc3339Timestamp } from '../core/result.ts';

export interface HarnessPathResolution {
  readonly root: string;
  readonly artifactPath: string;
  readonly source: 'explicit' | 'workspace';
  readonly observedAt: string;
}

export function normalizeHarnessPath(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError('artifact root must be non-empty');
  const normalized = value.trim().replaceAll('\\', '/');
  const prefix = /^[A-Za-z]:\//.test(normalized) ? normalized.slice(0, 3) : normalized.startsWith('//') ? '//' : '';
  const segments = normalized.slice(prefix.length).split('/');
  const output: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (output.length === 0) throw new Error('artifact path escape is not allowed');
      output.pop();
    } else output.push(segment);
  }
  return `${prefix}${output.join('/')}`;
}

export function resolveHarnessPath(root: string, workflowId: string): HarnessPathResolution {
  if (typeof workflowId !== 'string' || workflowId.trim().length === 0 || workflowId === '.' || workflowId === '..' || /[\\/]/.test(workflowId)) {
    throw new TypeError('workflowId must be a path-safe identifier');
  }
  const normalizedRoot = normalizeHarnessPath(root).replace(/\/$/, '');
  if (normalizedRoot.length === 0) throw new TypeError('artifact root must be non-empty');
  const observedAt = new Date().toISOString();
  if (!isRfc3339Timestamp(observedAt)) throw new Error('path observation timestamp is invalid');
  return { root: normalizedRoot, artifactPath: `${normalizedRoot}/workflows/${workflowId}.json`, source: 'explicit', observedAt };
}
