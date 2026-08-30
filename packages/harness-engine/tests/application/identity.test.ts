import { describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';

import { createApplicationIdentity, type FileInput } from '../../src/application/identity.ts';

describe('application identity mapping', () => {
  test('maps file input to a stable application identity without dynamic task content', () => {
    const input: FileInput & Record<string, unknown> = {
      artifactRoot: 'tmp/artifacts',
      workflowId: 'workflow-1',
      planId: 'plan-1',
      taskId: 'task-1',
      actorId: 'worker-1',
      expectedRevision: 7,
      inputDigest: 'sha256:assignment-only',
      prompt: 'do not copy this prompt',
      transcript: 'do not copy transcript',
      task正文: 'do not copy task正文',
    };

    const identity = createApplicationIdentity(input);

    expect(identity).toEqual({
      workflowId: 'workflow-1',
      planId: 'plan-1',
      taskId: 'task-1',
      actorId: 'worker-1',
      sourcePath: resolve(join('tmp/artifacts', 'workflows', 'workflow-1.json')),
      inputDigest: 'sha256:assignment-only',
    });
    const serialized = JSON.stringify(identity);
    expect(serialized).not.toContain('prompt');
    expect(serialized).not.toContain('transcript');
    expect(serialized).not.toContain('task正文');
  });

  test('requires explicit IDs, actor, and digest instead of synthetic defaults', () => {
    const valid: FileInput = {
      artifactRoot: 'tmp/artifacts',
      workflowId: 'workflow-1',
      actorId: 'worker-1',
      inputDigest: 'sha256:assignment-only',
    };

    for (const key of ['artifactRoot', 'workflowId', 'actorId', 'inputDigest'] as const) {
      expect(() => createApplicationIdentity({ ...valid, [key]: '' })).toThrow(key);
    }
    expect(() => createApplicationIdentity({ ...valid, workflowId: '../escape' })).toThrow('workflowId');
  });
});
