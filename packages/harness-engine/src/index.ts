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
export type {
  ClaimedLease,
  ExecutionLeaseClaim,
  IntegrationMergeLeaseClaim,
  Lease,
  LeaseClaim,
  LeaseClaimResult,
  LeaseReleaseResult,
  LeaseState,
  ReleasedLease,
  ResumedLease,
  StaleProof,
} from './domain/lease';
export {
  canStealLease,
  claimLease,
  releaseLease,
  validateLease,
} from './domain/lease';
export type {
  WorktreeAlignment,
  WorktreeAlignmentInput,
  WorktreeIdentity,
} from './gates/worktree';
export { validateWorktreeAlignment } from './gates/worktree';
export type {
  AssignmentBranchForm,
  AssignmentBranchFormKind,
  AssignmentBranchForms,
  AssignmentFields,
} from './domain/assignment';
export {
  parseAssignmentBranchForms,
  parseAssignmentExecutionMode,
  parseAssignmentFields,
} from './domain/assignment';
export type {
  BranchProtection,
  DispatchDecision,
  DispatchInput,
  DispatchLeaseState,
  HostCapability,
} from './gates/dispatch';
export { validateDispatch } from './gates/dispatch';
export type { ReviewPackage } from './domain/review';
export { createReviewPackage, isConcreteRevision, validateReviewPackage } from './domain/review';
export type { QcIdentity, ReviewReady, SddGateInput } from './gates/sdd';
export { validateSddGate } from './gates/sdd';
export type { IterationGateInput, IterationPhase, PhaseTransition } from './gates/iteration';
export { evaluateIterationGate } from './gates/iteration';
export type {
  MergeReady,
  PrReviewInput,
  PushCadenceInput,
  PushDecision,
  RequiredCheck,
  RequiredReview,
} from './gates/pr-review';
export { evaluatePrReview, evaluatePushCadence } from './gates/pr-review';
export type { ArtifactStore } from './ports/artifacts';
export { JsonArtifactStore } from './adapters/json/json-artifact-store';
