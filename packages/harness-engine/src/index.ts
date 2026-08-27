export type {
  EvidenceRef,
  GateFailureKind,
  GateResult,
  Known,
  RecoveryAction,
  Unknown,
  Violation,
} from './core/result';
export {
  isGateResult,
  isKnown,
  isUnknown,
  validateEvidenceRef,
  validateGateResult,
  validateKnown,
  validateRecoveryAction,
  validateUnknown,
  validateViolation,
} from './core/result';
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
  StaleProof,
} from './domain/lease';
export {
  canStealLease,
  claimLease,
  releaseLease,
  validateLease,
  validateStaleProof,
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
  parseAssignmentFields,
} from './domain/assignment';
export type {
  BranchProtection,
  DispatchDecision,
  DispatchInput,
  DispatchLeaseState,
} from './gates/dispatch';
export { validateDispatch } from './gates/dispatch';
export type { ReviewPackage } from './domain/review';
export { createReviewPackage, isConcreteRevision, validateResidualClosure, validateReviewPackage } from './domain/review';
export type { QcIdentity, ReviewReady, SddGateInput } from './gates/sdd';
export { validateSddGate } from './gates/sdd';
export type { IterationGateInput, IterationPhase, PhaseTransition, ResidualClosure } from './gates/iteration';
export { evaluateIterationGate } from './gates/iteration';
export type {
  MergeReady,
  PrReviewInput,
  RequiredCheck,
  RequiredReview,
  ReviewTally,
  ReviewVerdict,
} from './gates/pr-review';
export { calculateReviewTally, evaluatePrReview, evaluatePushCadence, validateMergeReady } from './gates/pr-review';
export type {
  AdapterMetadata,
  CoordinationAdapter,
  CoordinationDeliveryDto,
  CoordinationDispatchDto,
  CoordinationRunDto,
  CoordinationTaskDto,
  CoordinationWorkerDto,
  DeliveryDto,
  DispatchDto,
  PortResult,
  RunDto,
  TaskDto,
  WorkerDto,
} from './ports/coordination';
export {
  validateCoordinationDelivery,
  validateCoordinationDispatch,
  validateCoordinationRun,
  validateCoordinationTask,
  validateCoordinationWorker,
  validatePortResult,
} from './ports/coordination';
export type {
  DeliveryAdapter,
  DeliveryAfterMergeDto,
  DeliveryChecksDto,
  DeliveryIssueDto,
  DeliveryMergeReadyDto,
  DeliveryPullRequestDto,
  DeliveryRef,
  IssueRef,
  PullRequestRef,
  DeliveryReviewsDto,
} from './ports/delivery';
export {
  validateDeliveryAfterMerge,
  validateDeliveryChecks,
  validateDeliveryIssue,
  validateDeliveryMergeReady,
  validateDeliveryPullRequest,
  validateDeliveryReviews,
} from './ports/delivery';
export type {
  CapabilityResult,
  CapabilityStatus,
  HostAdapter,
  HostAssignment,
  HostCapabilityEvidence,
  HostContext,
  HostObservation,
  HostOperation,
  NonSupportedCapability,
  SupportedCapability,
} from './ports/host';
export {
  isCapabilityResult,
  isCapabilityStatus,
  validateCapabilityResult,
  validateCapabilityStatus,
} from './ports/host';
export type { CliResult } from './cli/index';
export { main as harnessMain, runCli } from './cli/index';
