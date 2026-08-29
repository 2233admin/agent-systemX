import type { ConfigurationRevision } from '../domain/configuration';
import type { ActivationOperation } from '../domain/activation-operation';
import type { ActivationStatus } from '../application/activation';

export function renderList(revisions: readonly ConfigurationRevision[]): string { return revisions.map((revision) => `${revision.configName} ${revision.revisionId}`).join('\n') || 'no configuration revisions'; }
export function renderDetail(revision: ConfigurationRevision): string { return [`config: ${revision.configName}`, `revision: ${revision.revisionId}`, `capabilities: ${revision.capabilities.map((capability) => `${capability.kind}:${capability.name}`).join(', ') || '(none)'}`, `supersedes: ${revision.supersedesRevisionId ?? '(none)'}`].join('\n'); }
export function renderConfirmationSummary(operation: ActivationOperation, revision: ConfigurationRevision): string { return [`Confirm activation`, `config: ${revision.configName}`, `revision: ${revision.revisionId}`, `client: ${operation.clientId}`, `capabilities: ${revision.capabilities.map((capability) => `${capability.kind}:${capability.name}`).join(', ') || '(none)'}`, `consequence: the client process will start and take over this terminal`, `confirm with y/Enter, cancel with n/Esc`].join('\n'); }
export function renderStatus(status: ActivationStatus): string { return [`operation: ${status.operation.operationId}`, `operation phase: ${status.operationPhase}`, `observation stage: ${status.observationStage}`, `observations: ${status.observations.length}`, `next: ${status.nextStep}`].join('\n'); }
export function renderFailure(operation: ActivationOperation): string {
  if (operation.phase === 'cancelled') return [`activation cancelled`, `operation: ${operation.operationId}`, `reason: ${operation.terminalReason ?? 'user cancelled'}`, `recovery: choose a revision and run configs use <revision> --client ${operation.clientId}`].join('\n');
  if (operation.phase === 'requires-restart') return [`activation requires restart`, `operation: ${operation.operationId}`, `reason: ${operation.terminalReason ?? 'restart required'}`, `recovery: restart the client, then run configs use <revision> --client ${operation.clientId}`].join('\n');
  return [`activation failed`, `operation: ${operation.operationId}`, `phase: ${operation.phase}`, `reason: ${operation.terminalReason ?? 'unknown'}`, `recovery: run configs use <revision> --client ${operation.clientId}`].join('\n');
}
export function renderSearchResults(results: readonly { readonly revisionId: string; readonly configName: string; readonly rank: number }[]): string { return results.map((result) => `${result.configName} ${result.revisionId} (${result.rank})`).join('\n') || 'no matches'; }
export function renderQueryFailure(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export function renderHandoffLine(): string { return 'handing off to client process'; }
