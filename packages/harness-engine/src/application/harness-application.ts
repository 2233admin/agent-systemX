import type { EvidenceRef, RecoveryAction, Unknown, Violation } from '../core/result.ts';
import { parseAssignmentBranchForms, parseAssignmentExecutionMode, parseAssignmentFields } from '../domain/assignment.ts';
import { transitionPlanStatus, type WorkflowSnapshot } from '../domain/workflow.ts';
import { validatePlanCompletion } from '../gates/completion.ts';
import type { ArtifactStore, WorkflowWriteResult } from '../ports/artifacts.ts';
import type {
  CompletePlanCommand,
  CreateWorkflowCommand,
  RegisterPlanCommand,
  WorkflowCommandResult,
  WorkflowSnapshotResult,
} from './commands.ts';
import type { ReadWorkflowQuery, StatusQuery, StatusView, ValidateQuery, ValidationView } from './queries.ts';

const EMPTY_EVIDENCE: readonly EvidenceRef[] = [];
const EMPTY_UNKNOWN: readonly Unknown[] = [];

function boundaryEvidence(stage: string, operationId: string, observedAt?: string): EvidenceRef {
  return {
    source: 'harness-engine.application',
    observedAt: observedAt ?? new Date().toISOString(),
    locator: `${stage}:${operationId}`,
  };
}

function applied<T>(stage: string, operationId: string, value: T, revision: number, observedAt?: string): WorkflowCommandResult<T> {
  return {
    kind: 'applied',
    value,
    revision,
    operationId,
    stage,
    evidenceRefs: [boundaryEvidence(stage, operationId, observedAt)],
    failureRefs: EMPTY_EVIDENCE,
    unknownFacts: EMPTY_UNKNOWN,
    violations: [],
    recoveryActions: [],
  };
}

function failed<T>(
  stage: string,
  operationId: string,
  revision: number,
  kind: 'rejected' | 'blocked' | 'unknown' | 'not-available',
  violations: readonly Violation[],
  recoveryActions: readonly RecoveryAction[],
): WorkflowCommandResult<T> {
  const evidence = boundaryEvidence(stage, operationId);
  return {
    kind,
    revision,
    operationId,
    stage,
    evidenceRefs: [evidence],
    failureRefs: [evidence],
    unknownFacts: kind === 'unknown' || kind === 'not-available'
      ? [{ kind: 'unknown', reasonCode: `${stage}.${kind}`, observedAt: evidence.observedAt, recovery: recoveryActions[0]?.code }]
      : EMPTY_UNKNOWN,
    violations,
    recoveryActions,
  };
}

function fromWriteResult<T>(stage: string, result: WorkflowWriteResult): WorkflowCommandResult<T> {
  if (result.kind === 'applied') return applied(stage, result.operationId, result.value as T, result.revision, result.value.updatedAt);
  return failed(stage, result.operationId, result.revision, result.kind === 'conflict' ? 'blocked' : 'rejected', result.violations, result.recoveryActions);
}

function assignmentValidation(input: ValidateQuery): ValidationView {
  const assignment = input.assignment.assignment ?? input.assignment.assignmentText;
  const violations: Violation[] = [];
  const fields = typeof assignment === 'string' ? parseAssignmentFields(assignment) : {};
  const branchForms = typeof assignment === 'string' ? parseAssignmentBranchForms(assignment) : { forms: [] as const };
  if (fields.executeAs === undefined) violations.push({ code: 'assignment.field.missing-execute-as' });
  if (fields.delegation === undefined) violations.push({ code: 'assignment.field.missing-delegation' });
  if (fields.taskCategory === undefined) violations.push({ code: 'assignment.field.missing-task-category' });
  const executionMode = typeof assignment === 'string' ? parseAssignmentExecutionMode(assignment) : undefined;
  if (executionMode !== 'sdd' && executionMode !== 'inline') violations.push({ code: 'assignment.execution-mode.unknown' });
  const branchTargets = branchForms.forms.filter((form) => form.kind !== 'direct-on');
  if (branchTargets.length === 0) violations.push({ code: 'branch.missing' });
  if (branchTargets.length > 1) violations.push({ code: 'branch.multiple-forms' });
  const branch = branchForms.workingBranch ?? branchForms.branchPolicy;
  const protection = input.assignment.branchProtection;
  const protectedBranches = typeof protection === 'object' && protection !== null && 'protectedBranches' in protection
    && Array.isArray(protection.protectedBranches) ? protection.protectedBranches : ['main', 'master'];
  const defaultBranch = typeof protection === 'object' && protection !== null && 'defaultBranch' in protection
    && typeof protection.defaultBranch === 'string' ? protection.defaultBranch : 'main';
  if (branch !== undefined && [...protectedBranches, defaultBranch].some((candidate) => candidate.toLowerCase() === branch.toLowerCase())
    && branchForms.directOnReason === undefined) {
    violations.push({ code: 'branch.protected-default' });
  }
  if (violations.length > 0) {
    return failed('validate', input.operationId, input.expectedRevision, 'rejected', violations,
      violations.map((violation) => ({ code: `recover.${violation.code}` })));
  }
  return applied('validate', input.operationId, { executeAs: fields.executeAs, delegation: fields.delegation, taskCategory: fields.taskCategory }, input.expectedRevision);
}

export class WorkflowFacade {
  public constructor(private readonly store: ArtifactStore) {}

  public async createWorkflow(input: CreateWorkflowCommand): Promise<WorkflowSnapshotResult> {
    const snapshot: WorkflowSnapshot = {
      schemaVersion: 1,
      revision: 1,
      workflowId: input.workflowId,
      plans: [],
      updatedAt: new Date().toISOString(),
    };
    return fromWriteResult('createWorkflow', await this.store.writeWorkflowConditional({
      expectedRevision: input.expectedRevision,
      next: snapshot,
      operationId: input.operationId,
      idempotencyKey: input.idempotencyKey,
      inputDigest: input.inputDigest,
    }));
  }

  public async readWorkflow(input: ReadWorkflowQuery): Promise<WorkflowSnapshotResult> {
    const snapshot = await this.store.readWorkflow(input.workflowId);
    if (snapshot === null) {
      return failed('readWorkflow', input.operationId, input.expectedRevision, 'blocked', [{ code: 'workflow.missing' }], [{ code: 'workflow.create' }]);
    }
    if (snapshot.revision !== input.expectedRevision) {
      return failed('readWorkflow', input.operationId, snapshot.revision, 'blocked', [{ code: 'artifact.revision.conflict' }], [{ code: 'artifact.revision.reread' }]);
    }
    return applied('readWorkflow', input.operationId, snapshot, snapshot.revision);
  }

  public async registerPlan(input: RegisterPlanCommand): Promise<WorkflowSnapshotResult> {
    const current = await this.store.readWorkflow(input.workflowId);
    if (current === null) return failed('registerPlan', input.operationId, input.expectedRevision, 'blocked', [{ code: 'workflow.missing' }], [{ code: 'workflow.create' }]);
    if (current.revision !== input.expectedRevision) return failed('registerPlan', input.operationId, current.revision, 'blocked', [{ code: 'artifact.revision.conflict' }], [{ code: 'artifact.revision.reread' }]);
    if (current.plans.some((plan) => plan.id === input.planId)) return failed('registerPlan', input.operationId, current.revision, 'rejected', [{ code: 'plan.duplicate' }], [{ code: 'plan.choose-new-id' }]);
    const next: WorkflowSnapshot = {
      ...current,
      revision: current.revision + 1,
      plans: [...current.plans, { id: input.planId, title: input.title, status: 'Todo', baseSha: input.baseSha, metadata: {} }],
    };
    return fromWriteResult('registerPlan', await this.store.writeWorkflowConditional({
      expectedRevision: input.expectedRevision,
      next,
      operationId: input.operationId,
      idempotencyKey: input.idempotencyKey,
      inputDigest: input.inputDigest,
    }));
  }

  public async validate(input: ValidateQuery): Promise<ValidationView> {
    return assignmentValidation(input);
  }

  public async status(input: StatusQuery): Promise<StatusView> {
    const snapshot = await this.store.readWorkflow(input.workflowId);
    if (snapshot === null) {
      return failed('status', input.operationId, input.expectedRevision, 'blocked', [{ code: 'workflow.missing' }], [{ code: 'workflow.create' }]);
    }
    if (input.consistency === 'exact' && snapshot.revision !== input.expectedRevision) {
      return failed('status', input.operationId, snapshot.revision, 'blocked', [{ code: 'artifact.revision.conflict' }], [{ code: 'artifact.revision.reread' }]);
    }
    return applied('status', input.operationId, snapshot, snapshot.revision);
  }
  public async completePlan(input: CompletePlanCommand): Promise<WorkflowSnapshotResult> {
    const gate = validatePlanCompletion(input.completion);
    if (gate.kind !== 'pass') {
      return failed('completePlan', input.operationId, input.expectedRevision, gate.kind === 'fail' ? 'rejected' : gate.kind, gate.violations, gate.recovery);
    }
    const current = await this.store.readWorkflow(input.workflowId);
    if (current === null) return failed('completePlan', input.operationId, input.expectedRevision, 'blocked', [{ code: 'workflow.missing' }], [{ code: 'workflow.create' }]);
    if (current.revision !== input.expectedRevision) return failed('completePlan', input.operationId, current.revision, 'blocked', [{ code: 'artifact.revision.conflict' }], [{ code: 'artifact.revision.reread' }]);
    if (input.completion.planRevision !== current.revision) {
      return failed('completePlan', input.operationId, current.revision, 'blocked', [{ code: 'completion.plan-revision.stale' }], [{ code: 'completion.plan-reread' }]);
    }
    const planIndex = current.plans.findIndex((plan) => plan.id === input.planId);
    const plan = current.plans[planIndex];
    if (plan === undefined) return failed('completePlan', input.operationId, current.revision, 'rejected', [{ code: 'plan.missing' }], [{ code: 'plan.register' }]);
    let completedPlan;
    try {
      completedPlan = transitionPlanStatus(plan, 'Done', { leaseRemaining: false, reviewComplete: true, qaComplete: true });
    } catch {
      return failed('completePlan', input.operationId, current.revision, 'rejected', [{ code: 'plan.transition.invalid' }], [{ code: 'plan.reconcile' }]);
    }
    const plans = [...current.plans];
    plans[planIndex] = completedPlan;
    const next: WorkflowSnapshot = { ...current, revision: current.revision + 1, plans };
    return fromWriteResult('completePlan', await this.store.writeWorkflowConditional({
      expectedRevision: input.expectedRevision,
      next,
      operationId: input.operationId,
      idempotencyKey: input.idempotencyKey,
      inputDigest: input.inputDigest,
    }));
  }
}

export function createWorkflowFacade(store: ArtifactStore): WorkflowFacade {
  return new WorkflowFacade(store);
}
