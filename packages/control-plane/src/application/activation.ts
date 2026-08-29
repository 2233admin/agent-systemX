import type { ActivationOperation } from '../domain/activation-operation';
import { createActivationOperation, transitionActivationOperation } from '../domain/activation-operation';
import type { ConfigurationRepository } from './ports/configuration-repository';
import type { ActivationOperationRepository } from './ports/activation-operation-repository';
import type { LaunchObservationRepository } from './ports/launch-observation-repository';
import type { ClientAdapter, ClientAdapterRegistry } from './ports/client-adapter';
import { configurationName, type ConfigurationRevision } from '../domain/configuration';
import { clientId } from '../domain/client';
import { createLaunchObservation, type LaunchObservation } from '../domain/launch-observation';
export interface ActivationDependencies {
  readonly configurations: ConfigurationRepository;
  readonly operations: ActivationOperationRepository;
  readonly observations: LaunchObservationRepository;
  readonly adapters: ClientAdapterRegistry;
}

export class ActivationNotFoundError extends Error {
  readonly kind = 'activation-not-found' as const;
  constructor(readonly operationId: string) { super(`activation operation not found: ${operationId}`); this.name = 'ActivationNotFoundError'; }
}
export class ClientAdapterNotFoundError extends Error {
  readonly kind = 'client-adapter-not-found' as const;
  constructor(readonly clientId: string) { super(`client adapter not found: ${clientId}`); this.name = 'ClientAdapterNotFoundError'; }
}

function operationFailure(operation: ActivationOperation, reason: string): ActivationOperation {
  const result = transitionActivationOperation(operation, { type: 'failed', reason });
  if (!result.ok) throw new Error(result.reason);
  return result.operation;
}

async function updateOperation(deps: ActivationDependencies, operation: ActivationOperation, next: ActivationOperation): Promise<ActivationOperation> {
  await deps.operations.updateIfVersion(operation.operationId, operation.version, next);
  return next;
}

export async function prepareActivation(deps: ActivationDependencies, params: { readonly revisionId: string; readonly clientId: string; readonly operationId?: string; readonly now?: string }): Promise<ActivationOperation> {
  const revision = await deps.configurations.findById(params.revisionId);
  const now = params.now ?? new Date().toISOString();
  const configName = revision?.configName ?? configurationName(params.revisionId);
  const operation = createActivationOperation({ operationId: params.operationId ?? `op-${crypto.randomUUID()}`, revisionId: revision?.revisionId ?? null, configName, clientId: clientId(params.clientId), planHash: `${params.revisionId}:${params.clientId}:${now}`, createdAt: now });
  if (revision === null) {
    const failed = operationFailure(operation, `revision-not-found:${params.revisionId}`);
    await deps.operations.insert(failed);
    return failed;
  }
  const transition = transitionActivationOperation(operation, { type: 'awaiting-confirmation' });
  if (!transition.ok) throw new Error(transition.reason);
  await deps.operations.insert(transition.operation);
  return transition.operation;
}

export async function confirmActivation(deps: ActivationDependencies, operationId: string): Promise<ActivationOperation> {
  const operation = await deps.operations.findById(operationId);
  if (operation === null) throw new ActivationNotFoundError(operationId);
  const result = transitionActivationOperation(operation, { type: 'confirmed' });
  if (!result.ok) throw new Error(result.reason);
  return updateOperation(deps, operation, result.operation);
}

export async function rejectActivation(deps: ActivationDependencies, operationId: string): Promise<ActivationOperation> {
  const operation = await deps.operations.findById(operationId);
  if (operation === null) throw new ActivationNotFoundError(operationId);
  const result = transitionActivationOperation(operation, { type: 'cancelled', reason: 'user-rejected-confirmation' });
  if (!result.ok) throw new Error(result.reason);
  return updateOperation(deps, operation, result.operation);
}

async function appendStage(deps: ActivationDependencies, operation: ActivationOperation, adapter: ClientAdapter, stage: LaunchObservation['stage'], outcome: LaunchObservation['outcome'], reason?: string, processReference?: LaunchObservation['processReference']): Promise<void> {
  await deps.observations.append(createLaunchObservation({ operationId: operation.operationId, clientId: adapter.clientId, stage, outcome, reason, processReference, observedAt: new Date().toISOString() }));
}

export async function executeActivation(deps: ActivationDependencies, operationId: string): Promise<ActivationOperation> {
  const operation = await deps.operations.findById(operationId);
  if (operation === null) throw new ActivationNotFoundError(operationId);
  if (operation.phase !== 'applying') throw new Error(`activation operation ${operationId} is not applying`);
  const adapter = deps.adapters.get(operation.clientId);
  if (adapter === null) {
    const failed = operationFailure(operation, `client-adapter-not-found:${operation.clientId}`);
    return updateOperation(deps, operation, failed);
  }
  const revision = operation.revisionId === null ? null : await deps.configurations.findById(operation.revisionId);
  if (revision === null) {
    const failed = operationFailure(operation, 'revision-not-found-before-execution');
    return updateOperation(deps, operation, failed);
  }
  let capability;
  try {
    capability = await adapter.probe?.();
  } catch (error) {
    const failed = operationFailure(operation, `client-probe-failed:${(error as Error).message}`);
    return updateOperation(deps, operation, failed);
  }
  if (capability !== undefined && capability.level !== 'supported' && capability.level !== 'degraded') {
    const failed = operationFailure(operation, `client-capability-${capability.level}:${capability.reason ?? 'no reason'}`);
    return updateOperation(deps, operation, failed);
  }
  const claimed = await deps.operations.claimApplying(operationId, operation.version, new Date().toISOString());
  try {
    const prepared = await adapter.prepare({ operationId, revision });
    await appendStage(deps, claimed, adapter, 'context-written', 'unknown');
    const started = await adapter.start({ operationId, revision, prepared });
    await appendStage(deps, claimed, adapter, 'process-started', 'unknown', undefined, started.processReference);
    const observed = await adapter.observe({ operationId, revision, started });
    await appendStage(deps, claimed, adapter, 'process-exited', observed.outcome, observed.reason, started.processReference);
    await appendStage(deps, claimed, adapter, 'outcome-observed', observed.outcome, observed.reason, started.processReference);
    const transition = transitionActivationOperation(claimed, observed.outcome === 'succeeded' ? { type: 'succeeded' } : observed.outcome === 'degraded' ? { type: 'degraded', reason: observed.reason } : { type: 'failed', reason: observed.reason ?? `launch-outcome:${observed.outcome}` });
    if (!transition.ok) throw new Error(transition.reason);
    return updateOperation(deps, claimed, transition.operation);
  } catch (error) {
    const reason = `activation-failed:${(error as Error).message}`;
    await appendStage(deps, claimed, adapter, 'outcome-observed', 'unknown', reason);
    const failed = operationFailure(claimed, reason);
    return updateOperation(deps, claimed, failed);
  }
}
export async function recoverActivation(deps: ActivationDependencies, operationId: string, reason = 'manual recovery: client outcome is unknown'): Promise<ActivationOperation> {
  const operation = await deps.operations.findById(operationId);
  if (operation === null) throw new ActivationNotFoundError(operationId);
  if (operation.phase !== 'applying') throw new Error(`activation operation ${operationId} is not recoverable from phase ${operation.phase}`);
  const claimed = await deps.operations.claimApplying(operationId, operation.version, new Date().toISOString());
  await deps.observations.append(createLaunchObservation({ operationId, clientId: claimed.clientId, stage: 'outcome-observed', outcome: 'unknown', processReference: undefined, reason, observedAt: new Date().toISOString() }));
  const result = transitionActivationOperation(claimed, { type: 'failed', reason });
  if (!result.ok) throw new Error(result.reason);
  return updateOperation(deps, claimed, result.operation);
}


export async function appendLaunchObservation(deps: ActivationDependencies, observation: LaunchObservation): Promise<void> {
  await deps.observations.append(observation);
}

export interface ActivationStatus {
  readonly operation: ActivationOperation;
  readonly observations: readonly LaunchObservation[];
  readonly operationPhase: ActivationOperation['phase'];
  readonly observationStage: LaunchObservation['stage'] | 'none';
  readonly nextStep: string;
}
function nextStep(operation: ActivationOperation, observations: readonly LaunchObservation[]): string {
  if (operation.phase === 'awaiting-confirmation') return 'confirm or cancel this activation';
  if (operation.phase === 'applying') {
    const stage = observations.at(-1)?.stage;
    if (stage === undefined || stage === 'context-written') return `run configs recover ${operation.operationId} after confirming no client process remains`;
    if (stage === 'process-started') return `run configs recover ${operation.operationId} after confirming no client process remains`;
    return `run configs recover ${operation.operationId} to record the unknown outcome`;
  }
  if (operation.phase === 'requires-restart') return 'restart the client, then prepare a new activation';
  if (operation.phase === 'failed') return 'inspect the latest observation reason and retry with a new operation';
  if (operation.phase === 'cancelled') return 'choose a revision to prepare a new activation';
  return 'no further action is required';
}

export async function getActivationStatus(deps: ActivationDependencies, operationId: string): Promise<ActivationStatus> {
  const operation = await deps.operations.findById(operationId);
  if (operation === null) throw new ActivationNotFoundError(operationId);
  const observations = await deps.observations.listByOperation(operationId);
  return { operation, observations, operationPhase: operation.phase, observationStage: observations.at(-1)?.stage ?? 'none', nextStep: nextStep(operation, observations) };
}

export async function requestConfigurationSwitch(deps: ActivationDependencies, params: { readonly currentOperationId: string; readonly newRevisionId: string; readonly clientId: string }): Promise<{ readonly previous: ActivationOperation; readonly next: ActivationOperation }> {
  const current = await deps.operations.findById(params.currentOperationId);
  if (current === null) throw new ActivationNotFoundError(params.currentOperationId);
  if (current.phase !== 'succeeded' && current.phase !== 'degraded') throw new Error(`switch is not allowed from operation phase ${current.phase}; use a new activation explicitly`);
  const target = await deps.configurations.findById(params.newRevisionId);
  if (target === null) throw new Error(`revision not found: ${params.newRevisionId}`);
  if (deps.adapters.get(clientId(params.clientId)) === null) throw new ClientAdapterNotFoundError(params.clientId);
  const transitioned = transitionActivationOperation(current, { type: 'requires-restart', reason: 'configuration-switch-requested' });
  if (!transitioned.ok) throw new Error(transitioned.reason);
  const previous = await updateOperation(deps, current, transitioned.operation);
  const nextOperation = await prepareActivation(deps, { revisionId: target.revisionId, clientId: params.clientId });
  return { previous, next: nextOperation };
}
