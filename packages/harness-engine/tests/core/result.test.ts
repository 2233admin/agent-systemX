import { describe, expect, test } from 'bun:test';

import {
  isGateResult,
  isKnown,
  isUnknown,
  known,
  unknown,
  validateEvidenceRef,
  validateGateResult,
} from '../../src/core/result';
import { validateArtifactRevision, validateStableIdentity } from '../../src/core/ids';
import type { EvidenceRef, GateResult, Known, Unknown } from '../../src/core/result';
import {
  isCapabilityStatus,
  validateCapabilityResult,
  validateCapabilityStatus,
  type CapabilityResult,
} from '../../src/ports/host';
import {
  validateCoordinationDelivery,
  validateCoordinationDispatch,
  validateCoordinationRun,
  validateCoordinationTask,
  validateCoordinationWorker,
  type CoordinationDeliveryDto,
  type CoordinationDispatchDto,
  type CoordinationRunDto,
  type CoordinationTaskDto,
  type CoordinationWorkerDto,
} from '../../src/ports/coordination';
import {
  validateDeliveryChecks,
  validateDeliveryIssue,
  validateDeliveryPullRequest,
  validateDeliveryReviews,
  type DeliveryChecksDto,
  type DeliveryIssueDto,
  type DeliveryPullRequestDto,
  type DeliveryReviewsDto,
} from '../../src/ports/delivery';

const observedAt = '2026-08-27T12:00:00.000Z';
const evidence: EvidenceRef = {
  source: 'unit-test',
  observedAt,
  locator: 'result.test.ts:1',
};

describe('core result contracts', () => {
  test('Known and Unknown retain their discriminants and payloads', () => {
    const resolved: Known<string> = known('ready', evidence);
    const unresolved: Unknown = unknown('not-observable', observedAt, 'retry after the host is available');

    expect(resolved).toEqual({ kind: 'known', value: 'ready', evidence });
    expect(unresolved).toEqual({
      kind: 'unknown',
      reasonCode: 'not-observable',
      observedAt,
      recovery: 'retry after the host is available',
    });
    expect(isKnown(resolved)).toBe(true);
    expect(isUnknown(unresolved)).toBe(true);
  });

  test('gate results accept pass/fail/blocked/unknown and reject other kinds', () => {
    const pass: GateResult<string> = { kind: 'pass', value: 'ready', evidence: [evidence] };
    const failure: GateResult<string> = {
      kind: 'fail',
      violations: [{ code: 'result.invalid' }],
      recovery: [{ code: 'result.retry', description: 'collect the missing evidence' }],
    };

    expect(isGateResult(pass)).toBe(true);
    expect(isGateResult(failure)).toBe(true);
    expect(isGateResult({ kind: 'blocked', violations: [], recovery: [] })).toBe(true);
    expect(isGateResult({ kind: 'unknown', violations: [], recovery: [] })).toBe(true);
    expect(isGateResult({ kind: 'success' })).toBe(false);
    expect(isGateResult({ kind: 'pass', evidence: [] })).toBe(false);
    expect(() => validateGateResult({ kind: 'pass', evidence: [] })).toThrow();
    expect(() => validateGateResult({ kind: 'fail', violations: [{ code: '   ' }], recovery: [] })).toThrow();
  });

  test('evidence contains source and an RFC 3339 observedAt timestamp', () => {
    expect(validateEvidenceRef({ source: 'unit-test', observedAt: '2026-08-27t12:00:00z' })).toEqual({
      source: 'unit-test',
      observedAt: '2026-08-27t12:00:00z',
    });
    expect(validateEvidenceRef(evidence)).toEqual(evidence);
    expect(() => validateEvidenceRef({ source: 'unit-test', observedAt: 'not-a-timestamp' })).toThrow();
    expect(() => validateEvidenceRef({ source: 'unit-test', observedAt: '2026-02-30T12:00:00Z' })).toThrow();
  });

  test('empty stable identity fields are rejected', () => {
    expect(() => validateStableIdentity({ workflowId: '', planId: 'plan-1' })).toThrow();
    expect(() => validateStableIdentity({ workflowId: 'workflow-1', planId: '  ' })).toThrow();
    expect(validateStableIdentity({ workflowId: 'workflow-1', planId: 'plan-1', taskId: 'task-1' })).toEqual({
      workflowId: 'workflow-1',
      planId: 'plan-1',
      taskId: 'task-1',
    });
  });

  test('artifact revisions carry numeric versions and an RFC 3339 updatedAt', () => {
    expect(
      validateArtifactRevision({ schemaVersion: 0, revision: 0, updatedAt: observedAt }),
    ).toEqual({ schemaVersion: 0, revision: 0, updatedAt: observedAt });
    expect(() => validateArtifactRevision({ schemaVersion: 1, revision: 1, updatedAt: 'yesterday' })).toThrow();
  });
});

describe('adapter port contracts', () => {
  const run: CoordinationRunDto = {
    runId: 'run-1',
    status: 'running',
    source: 'coordination-test',
    version: '1',
    observedAt,
  };
  const task: CoordinationTaskDto = {
    taskId: 'task-1',
    runId: 'run-1',
    planId: 'plan-1',
    status: 'ready',
    source: 'coordination-test',
    version: '1',
    observedAt,
  };
  const dispatch: CoordinationDispatchDto = {
    dispatchId: 'dispatch-1',
    taskId: 'task-1',
    status: 'assigned',
    source: 'coordination-test',
    version: '1',
    observedAt,
  };
  const worker: CoordinationWorkerDto = {
    workerId: 'worker-1',
    status: 'available',
    source: 'coordination-test',
    version: '1',
    observedAt,
  };
  const delivery: CoordinationDeliveryDto = {
    deliveryId: 'delivery-1',
    status: 'pending',
    source: 'coordination-test',
    version: '1',
    observedAt,
  };

  test('coordination DTOs accept only the explicit allowlist', () => {
    expect(validateCoordinationRun(run)).toBe(true);
    expect(validateCoordinationTask(task)).toBe(true);
    expect(validateCoordinationDispatch(dispatch)).toBe(true);
    expect(validateCoordinationWorker(worker)).toBe(true);
    expect(validateCoordinationDelivery(delivery)).toBe(true);

    expect(validateCoordinationTask({ ...task, prompt: 'do not expose this' })).toBe(false);
    expect(validateCoordinationTask({ ...task, transcript: 'secret transcript' })).toBe(false);
    expect(validateCoordinationTask({ ...task, credentials: 'secret' })).toBe(false);
    expect(validateCoordinationTask({ ...task, toolPayload: { token: 'secret' } })).toBe(false);
    expect(validateCoordinationTask({ ...task, task正文: 'dynamic task body' })).toBe(false);
  });

  test('delivery DTOs carry stable refs and reject dynamic payload fields', () => {
    const issue: DeliveryIssueDto = {
      owner: 'octo',
      repository: 'harness',
      number: 7,
      state: 'open',
      source: 'delivery-test',
      version: '1',
      observedAt,
    };
    const pullRequest: DeliveryPullRequestDto = {
      owner: 'octo',
      repository: 'harness',
      number: 8,
      state: 'open',
      headSha: '0123456789abcdef0123456789abcdef01234567',
      source: 'delivery-test',
      version: '1',
      observedAt,
    };
    const checks: DeliveryChecksDto = {
      owner: 'octo',
      repository: 'harness',
      number: 8,
      expectedHead: pullRequest.headSha,
      conclusion: 'success',
      source: 'delivery-test',
      version: '1',
      observedAt,
    };
    const reviews: DeliveryReviewsDto = {
      owner: 'octo',
      repository: 'harness',
      number: 8,
      expectedHead: pullRequest.headSha,
      approved: true,
      source: 'delivery-test',
      version: '1',
      observedAt,
    };

    expect(validateDeliveryIssue(issue)).toBe(true);
    expect(validateDeliveryPullRequest(pullRequest)).toBe(true);
    expect(validateDeliveryChecks(checks)).toBe(true);
    expect(validateDeliveryReviews(reviews)).toBe(true);
    expect(validateDeliveryIssue({ ...issue, transcript: 'do not expose this' })).toBe(false);
    expect(validateDeliveryPullRequest({ ...pullRequest, toolPayload: {} })).toBe(false);
  });

  test('capability statuses are closed and supported results require evidence', () => {
    expect(isCapabilityStatus('supported')).toBe(true);
    expect(isCapabilityStatus('degraded')).toBe(true);
    expect(isCapabilityStatus('unsupported')).toBe(true);
    expect(isCapabilityStatus('unknown')).toBe(true);
    expect(isCapabilityStatus('success')).toBe(false);
    expect(() => validateCapabilityStatus('success')).toThrow();

    const supported: CapabilityResult = { status: 'supported', evidence };
    expect(validateCapabilityResult(supported)).toEqual(supported);
    expect(() => validateCapabilityResult({ status: 'supported' })).toThrow();
    expect(() => validateCapabilityResult({ status: 'unknown' })).toThrow();
    expect(() => validateCapabilityResult({ status: 'unsupported' })).toThrow();
    expect(validateCapabilityResult({
      status: 'unsupported',
      reasonCode: 'host.not-installed',
    })).toEqual({
      status: 'unsupported',
      reasonCode: 'host.not-installed',
    });
  });

  // @ts-expect-error 动态任务正文不属于协调 DTO allowlist。
  const forbiddenPrompt: CoordinationTaskDto = { ...task, prompt: 'secret' };
  const forbiddenCredential: DeliveryIssueDto = {
    owner: 'octo',
    repository: 'harness',
    number: 7,
    state: 'open',
    source: 'delivery-test',
    version: '1',
    observedAt,
    // @ts-expect-error 凭据不属于交付 DTO allowlist。
    credentials: 'secret',
  };
  // @ts-expect-error 无证据不能声明 host capability supported。
  const unsupportedClaim: CapabilityResult = { status: 'supported' };

  expect(forbiddenPrompt).toBeDefined();
  expect(forbiddenCredential).toBeDefined();
  expect(unsupportedClaim).toBeDefined();
});
