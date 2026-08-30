import { join, resolve } from 'node:path';

import type { ApplicationWriteAuthorization } from '../ports/artifacts.ts';

export interface FileInput {
  readonly artifactRoot: string;
  readonly workflowId: string;
  readonly planId?: string;
  readonly taskId?: string;
  readonly actorId: string;
  readonly expectedRevision?: number;
  readonly inputDigest: string;
}

export interface ApplicationIdentity {
  readonly workflowId: string;
  readonly planId?: string;
  readonly taskId?: string;
  readonly actorId: string;
  readonly sourcePath: string;
  readonly inputDigest: string;
}

function requiredIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function assertPathSafeWorkflowId(workflowId: string): void {
  if (workflowId === '.' || workflowId === '..' || /[\\/]/.test(workflowId)) {
    throw new TypeError('workflowId must be a path-safe identifier');
  }
}

export function createApplicationIdentity(input: FileInput): ApplicationIdentity {
  const artifactRoot = requiredIdentifier(input.artifactRoot, 'artifactRoot');
  const workflowId = requiredIdentifier(input.workflowId, 'workflowId');
  const actorId = requiredIdentifier(input.actorId, 'actorId');
  const inputDigest = requiredIdentifier(input.inputDigest, 'inputDigest');
  assertPathSafeWorkflowId(workflowId);

  const planId = input.planId === undefined ? undefined : requiredIdentifier(input.planId, 'planId');
  const taskId = input.taskId === undefined ? undefined : requiredIdentifier(input.taskId, 'taskId');
  return {
    workflowId,
    ...(planId === undefined ? {} : { planId }),
    ...(taskId === undefined ? {} : { taskId }),
    actorId,
    sourcePath: resolve(join(artifactRoot, 'workflows', `${workflowId}.json`)),
    inputDigest,
  };
}

export function createApplicationWriteAuthorization(
  identity: ApplicationIdentity,
  nonce = `${identity.actorId}:${identity.inputDigest}`,
): ApplicationWriteAuthorization {
  return {
    kind: 'harness-application-write',
    applicationId: `${identity.workflowId}:${identity.actorId}:${identity.inputDigest}`,
    nonce,
  };
}
