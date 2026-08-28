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
  ResumedLease,
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
  parseAssignmentExecutionMode,
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
export type {
  DeliveryEvidence,
  PlanCompletion,
  PlanCompletionInput,
  QaEvidence,
  QcEvidence,
  ResidualClosure as CompletionResidualClosure,
} from './gates/completion';
export { validateOwnershipInventory, validatePlanCompletion } from './gates/completion';
export type { IterationGateInput, IterationPhase, PhaseTransition, ResidualClosure } from './gates/iteration';
export { evaluateIterationGate } from './gates/iteration';
export type {
  MergeReady,
  PrReviewInput,
  PushCadenceInput,
  PushDecision,
  RequiredCheck,
  RequiredReview,
  ReviewTally,
  ReviewVerdict,
} from './gates/pr-review';
export { calculateReviewTally, evaluatePrReview, evaluatePushCadence, validateMergeReady } from './gates/pr-review';
export type { ArtifactStore, WorkflowWriteRequest, WorkflowWriteResult } from './ports/artifacts';
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
export type {
  CommandEvidence,
  CommandsEvidence,
  FailureLedger,
  FailureLedgerRow,
  OwnershipRecord,
  RerunResult,
} from './validation/failure-ledger';
export {
  isCommandsEvidence,
  isFailureLedger,
  isOwnershipRecord,
  validateCommandEvidence,
  validateCommandsEvidence,
  validateFailureLedger,
  validateOwnershipRecord,
} from './validation/failure-ledger';
export type {
  CanonicalArtifactEnvelope,
  CanonicalArtifactKind,
} from './artifacts/canonical';
export {
  canonicalHashFor,
  canonicalize,
  createCanonicalArtifact,
  validateCanonicalArtifact,
} from './artifacts/canonical';
export type {
  AdapterCorrelationEnvelope,
  AdapterEventCorrelation,
  AdapterError,
  AdapterRequestCorrelation,
  ControlledTransport,
} from './adapters/contracts';
export {
  evidenceForCorrelation,
  reconcileCorrelation,
  reconcileEventSequence,
  unknownAdapterResult,
  validateAdapterCorrelation,
  validateAdapterError,
  validateAdapterEventCorrelation,
  validateAdapterRequestCorrelation,
} from './adapters/contracts';
export { ControlledOrcaAdapter } from './adapters/orca/orca-adapter';
export type { OrcaAdapter, OrcaObservationInput } from './adapters/orca/orca-adapter';
export { ControlledGithubAdapter } from './adapters/github/github-adapter';
export type { GithubAdapter, GithubReadbackContext } from './adapters/github/github-adapter';
export { ControlledHostAdapter } from './adapters/hosts/controlled-host-adapter';
export type {
  ClaudeHostAdapter,
  CodexHostAdapter,
  OmpHostAdapter,
  OpencodeHostAdapter,
} from './adapters/hosts/controlled-host-adapter';
export type {
  CompletePlanCommand,
  WorkflowCommandEnvelope,
  WorkflowCommandResult,
} from './application/commands';
export type { ReadWorkflowQuery, StatusQuery, StatusView, ValidateQuery, ValidationView } from './application/queries';
export { createWorkflowFacade, WorkflowFacade } from './application/harness-application';
export type { CliResult } from './cli/index';
export { main as harnessMain, runCli } from './cli/index';
