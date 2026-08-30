import { createJsonArtifactStore } from '../adapters/json/json-artifact-store.ts';
import { claimLease, releaseLease, type ExecutionLease } from '../domain/lease.ts';
import {
  transitionPlanStatus,
  type CompletionEvidence,
  type PlanRow,
  type WorkflowSnapshot,
} from '../domain/workflow.ts';
import { validateDispatch } from '../gates/dispatch.ts';
import type { ApplicationWriteAuthorization, GuardedArtifactStore } from '../ports/artifacts.ts';
import type {
  AppendCompletionEvidenceCommand,
  ClaimExecutionLeaseCommand,
  CreateWorkflowCommand,
  RegisterAssignmentCommand,
  RegisterPlanCommand,
  ReleaseExecutionLeaseCommand,
  TransitionPlanCommand,
  ValidateCommand,
} from './commands.ts';
import {
  createApplicationIdentity,
  createApplicationWriteAuthorization,
  type ApplicationIdentity,
  type FileInput,
} from './identity.ts';
import type { StatusQuery, StatusView, ValidateQuery, ValidationView } from './queries.ts';

export class ApplicationCommandError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = 'ApplicationCommandError';
    this.code = code;
  }
}

export interface HarnessApplication {
  createWorkflow(input: CreateWorkflowCommand): Promise<WorkflowSnapshot>;
  readWorkflow(workflowId?: string): Promise<WorkflowSnapshot | null>;
  registerPlan(input: RegisterPlanCommand): Promise<WorkflowSnapshot>;
  registerAssignment(input: RegisterAssignmentCommand): Promise<WorkflowSnapshot>;
  transitionPlan(input: TransitionPlanCommand): Promise<WorkflowSnapshot>;
  claimExecutionLease(input: ClaimExecutionLeaseCommand): Promise<WorkflowSnapshot>;
  releaseExecutionLease(input: ReleaseExecutionLeaseCommand): Promise<WorkflowSnapshot>;
  appendCompletionEvidence(input: AppendCompletionEvidenceCommand): Promise<WorkflowSnapshot>;
  status(input: StatusQuery): Promise<StatusView>;
  validate(input: ValidateQuery): Promise<ValidationView>;
}

interface HarnessApplicationDeps {
  readonly identity: ApplicationIdentity;
  readonly store: GuardedArtifactStore;
  readonly authorization: ApplicationWriteAuthorization;
  readonly expectedRevision?: number;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApplicationCommandError(`${field}.missing`, `${field} must be a non-empty string`);
  }
  return value.trim();
}

function commandRevision(command: { readonly expectedRevision?: number }, fallback?: number): number {
  const revision = command.expectedRevision ?? fallback;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
    throw new ApplicationCommandError('workflow.expected-revision.missing', 'expectedRevision must be a non-negative safe integer');
  }
  return revision;
}

function assertPlanReady(plan: PlanRow): PlanRow {
  requiredText(plan.id, 'plan.id');
  requiredText(plan.title, 'plan.title');
  if (plan.metadata === null || typeof plan.metadata !== 'object' || Array.isArray(plan.metadata)) {
    throw new ApplicationCommandError('plan.metadata.invalid', 'plan metadata must be an object');
  }
  return plan;
}

function findPlanIndex(snapshot: WorkflowSnapshot, planId: string): number {
  const index = snapshot.plans.findIndex((plan) => plan.id === planId);
  if (index === -1) {
    throw new ApplicationCommandError('plan.missing', `plan ${planId} does not exist`);
  }
  return index;
}

function replacePlan(snapshot: WorkflowSnapshot, index: number, plan: PlanRow): readonly PlanRow[] {
  return snapshot.plans.map((candidate, candidateIndex) => (candidateIndex === index ? plan : candidate));
}

function completionCode(evidence: CompletionEvidence | undefined): string | null {
  if (evidence === undefined) return 'plan.done.completion-evidence.missing';
  if (evidence.completionKind === 'worker_done') return 'plan.done.worker-done-insufficient';
  if (evidence.leaseRemaining === true || evidence.executionLeaseRemaining === true || evidence.integrationMergeLeaseRemaining === true) {
    return 'plan.done.lease-remaining';
  }
  if (evidence.reviewComplete !== true || evidence.requiredReviewMissing === true) return 'plan.done.review-missing';
  if (evidence.qaComplete !== true || evidence.requiredQaMissing === true) return 'plan.done.qa-missing';
  return null;
}

function withRevision(snapshot: WorkflowSnapshot, revision: number): WorkflowSnapshot {
  return { ...snapshot, revision };
}

function emptySnapshot(identity: ApplicationIdentity, revision: number, plan: PlanRow): WorkflowSnapshot {
  return {
    schemaVersion: 1,
    revision,
    workflowId: identity.workflowId,
    plans: [plan],
  };
}

async function mutate(
  deps: HarnessApplicationDeps,
  command: { readonly expectedRevision?: number },
  apply: (snapshot: WorkflowSnapshot | null, expectedRevision: number) => WorkflowSnapshot,
): Promise<WorkflowSnapshot> {
  const expectedRevision = commandRevision(command, deps.expectedRevision);
  const current = await deps.store.readWorkflow(deps.identity.workflowId);
  const currentRevision = current?.revision ?? 0;
  if (currentRevision !== expectedRevision) {
    throw new ApplicationCommandError('workflow.revision.stale', `Workflow revision conflict: expected ${expectedRevision}, found ${currentRevision}`);
  }
  const next = apply(current, expectedRevision);
  await deps.store.writeWorkflow(expectedRevision, next, deps.authorization);
  const stored = await deps.store.readWorkflow(deps.identity.workflowId);
  if (stored === null) {
    throw new ApplicationCommandError('workflow.write.missing', 'Workflow write did not produce a readable artifact');
  }
  return stored;
}

function statusView(snapshot: WorkflowSnapshot): StatusView {
  return {
    workflowId: snapshot.workflowId,
    revision: snapshot.revision,
    plans: snapshot.plans.map((plan) => ({ id: plan.id, status: plan.status, lease: plan.executionLease === undefined ? 'none' : 'execution' })),
    integrationMergeLease: snapshot.integrationMergeLease === undefined ? 'none' : 'integration-merge',
  };
}
function mapTransitionError(error: unknown, nextStatus: string, evidence: CompletionEvidence | undefined): never {
  const code = nextStatus === 'Done'
    ? completionCode(evidence) ?? 'plan.transition.invalid'
    : 'plan.transition.invalid';
  const message = error instanceof Error ? error.message : 'Plan transition failed';
  throw new ApplicationCommandError(code, message);
}

export function createHarnessApplication(deps: HarnessApplicationDeps): HarnessApplication {
  const identity = deps.identity;
  const store = deps.store;

  return {
    async createWorkflow(input: CreateWorkflowCommand): Promise<WorkflowSnapshot> {
      if (input.workflowId !== undefined && input.workflowId !== identity.workflowId) {
        throw new ApplicationCommandError('workflow.identity.mismatch', 'workflowId must match the application identity');
      }
      const plan = assertPlanReady({ ...input.plan, status: input.plan.status ?? 'Todo' });
      return mutate(deps, input, (current, expectedRevision) => {
        if (current !== null) {
          throw new ApplicationCommandError('workflow.exists', 'Workflow already exists');
        }
        return emptySnapshot(identity, expectedRevision + 1, plan);
      });
    },

    async readWorkflow(workflowId?: string): Promise<WorkflowSnapshot | null> {
      const requested = workflowId ?? identity.workflowId;
      if (requested !== identity.workflowId) {
        throw new ApplicationCommandError('workflow.identity.mismatch', 'workflowId must match the application identity');
      }
      return store.readWorkflow(identity.workflowId);
    },

    async registerPlan(input: RegisterPlanCommand): Promise<WorkflowSnapshot> {
      const plan = assertPlanReady(input.plan);
      return mutate(deps, input, (current, expectedRevision) => {
        if (current === null) {
          throw new ApplicationCommandError('workflow.missing', 'Workflow must exist before registering a plan');
        }
        if (current.plans.some((candidate) => candidate.id === plan.id)) {
          throw new ApplicationCommandError('plan.duplicate', `plan ${plan.id} already exists`);
        }
        return withRevision({ ...current, plans: [...current.plans, plan] }, expectedRevision + 1);
      });
    },

    async registerAssignment(input: RegisterAssignmentCommand): Promise<WorkflowSnapshot> {
      const planId = requiredText(input.planId, 'plan.id');
      const assignmentDigest = requiredText(input.assignmentDigest, 'assignmentDigest');
      const executeAs = requiredText(input.executeAs, 'executeAs');
      const branch = requiredText(input.branch, 'branch');
      const worktreePath = requiredText(input.worktreePath, 'worktreePath');
      return mutate(deps, input, (current, expectedRevision) => {
        if (current === null) {
          throw new ApplicationCommandError('workflow.missing', 'Workflow must exist before registering an assignment');
        }
        const index = findPlanIndex(current, planId);
        const plan = current.plans[index]!;
        const metadata = {
          ...plan.metadata,
          ...input.metadata,
          assignmentDigest,
          executeAs,
          branch,
          worktreePath,
        };
        return withRevision({ ...current, plans: replacePlan(current, index, { ...plan, metadata }) }, expectedRevision + 1);
      });
    },

    async transitionPlan(input: TransitionPlanCommand): Promise<WorkflowSnapshot> {
      const planId = requiredText(input.planId, 'plan.id');
      const completionFailure = input.nextStatus === 'Done' ? completionCode(input.completionEvidence) : null;
      if (completionFailure !== null) {
        throw new ApplicationCommandError(completionFailure, 'Done requires completion evidence, lease release, review, and QA');
      }
      return mutate(deps, input, (current, expectedRevision) => {
        if (current === null) {
          throw new ApplicationCommandError('workflow.missing', 'Workflow must exist before transitioning a plan');
        }
        const index = findPlanIndex(current, planId);
        try {
          const plan = transitionPlanStatus(current.plans[index]!, input.nextStatus, input.completionEvidence);
          return withRevision({ ...current, plans: replacePlan(current, index, plan) }, expectedRevision + 1);
        } catch (error) {
          mapTransitionError(error, input.nextStatus, input.completionEvidence);
        }
      });
    },

    async claimExecutionLease(input: ClaimExecutionLeaseCommand): Promise<WorkflowSnapshot> {
      const planId = requiredText(input.planId, 'plan.id');
      const holderId = requiredText(input.holderId, 'holderId');
      const worktreePath = requiredText(input.worktreePath, 'worktreePath');
      return mutate(deps, input, (current, expectedRevision) => {
        if (current === null) {
          throw new ApplicationCommandError('workflow.missing', 'Workflow must exist before claiming a lease');
        }
        const index = findPlanIndex(current, planId);
        const plan = current.plans[index]!;
        if (plan.executionLease !== undefined) {
          throw new ApplicationCommandError('lease.duplicate-claim', 'Execution lease is already claimed');
        }
        const result = claimLease(undefined, {
          kind: 'execution',
          workflowId: identity.workflowId,
          planId,
          holderId,
          worktreePath,
          claimedAt: input.claimedAt,
        }, input.staleProof);
        if (result.kind !== 'claimed') {
          throw new ApplicationCommandError('lease.claim.blocked', result.reason);
        }
        const executionLease: ExecutionLease = result.lease;
        return withRevision({ ...current, plans: replacePlan(current, index, { ...plan, executionLease }) }, expectedRevision + 1);
      });
    },

    async releaseExecutionLease(input: ReleaseExecutionLeaseCommand): Promise<WorkflowSnapshot> {
      const planId = requiredText(input.planId, 'plan.id');
      return mutate(deps, input, (current, expectedRevision) => {
        if (current === null) {
          throw new ApplicationCommandError('workflow.missing', 'Workflow must exist before releasing a lease');
        }
        const index = findPlanIndex(current, planId);
        const plan = current.plans[index]!;
        const result = releaseLease(plan.executionLease, input.holderId, input.fencingToken);
        if (result.kind !== 'released') {
          throw new ApplicationCommandError('lease.release.blocked', result.reason);
        }
        const { executionLease: _releasedLease, ...releasedPlan } = plan;
        return withRevision({ ...current, plans: replacePlan(current, index, releasedPlan) }, expectedRevision + 1);
      });
    },

    async appendCompletionEvidence(input: AppendCompletionEvidenceCommand): Promise<WorkflowSnapshot> {
      const planId = requiredText(input.planId, 'plan.id');
      if (completionCode(input.evidence) !== null) {
        throw new ApplicationCommandError(completionCode(input.evidence) ?? 'plan.done.completion-evidence.invalid', 'Completion evidence is incomplete');
      }
      return mutate(deps, input, (current, expectedRevision) => {
        if (current === null) {
          throw new ApplicationCommandError('workflow.missing', 'Workflow must exist before appending completion evidence');
        }
        const index = findPlanIndex(current, planId);
        const plan = current.plans[index]!;
        const existing = Array.isArray(plan.metadata.completionEvidence) ? plan.metadata.completionEvidence : [];
        const metadata = { ...plan.metadata, completionEvidence: [...existing, input.evidence] };
        return withRevision({ ...current, plans: replacePlan(current, index, { ...plan, metadata }) }, expectedRevision + 1);
      });
    },

    async status(input: StatusQuery): Promise<StatusView> {
      const snapshot = await this.readWorkflow(input.workflowId);
      if (snapshot === null) {
        throw new ApplicationCommandError('workflow.artifact.missing', 'Workflow artifact is missing');
      }
      return statusView(snapshot);
    },

    async validate(input: ValidateCommand): Promise<ValidationView> {
      return { result: validateDispatch(input) };
    },
  };
}

export function createFileHarnessApplication(input: FileInput): HarnessApplication {
  const identity = createApplicationIdentity(input);
  const authorization = createApplicationWriteAuthorization(identity);
  return createHarnessApplication({
    identity,
    authorization,
    expectedRevision: input.expectedRevision,
    store: createJsonArtifactStore(input.artifactRoot, authorization),
  });
}
