export type {
  EvidenceRef,
  GateFailureKind,
  GateResult,
  Known,
  RecoveryAction,
  Unknown,
  Violation,
} from './core/result';
export type { ArtifactRevision, StableIdentity } from './core/ids';
export {
  isPlanStatus,
  transitionPlanStatus,
} from './domain/workflow';
export type {
  CompletionEvidence,
  ExecutionLease,
  IntegrationMergeLease,
  PlanRow,
  PlanStatus,
  WorkflowSnapshot,
} from './domain/workflow';
export type { ArtifactStore } from './ports/artifacts';
export { JsonArtifactStore } from './adapters/json/json-artifact-store';
