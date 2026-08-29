import { describe, expect, test } from 'bun:test';
import { ControlledOrcaAdapter } from '../../src/adapters/orca/orca-adapter.ts';
import { ControlledGithubAdapter } from '../../src/adapters/github/github-adapter.ts';
import { ControlledHostAdapter } from '../../src/adapters/hosts/controlled-host-adapter.ts';
import type { ControlledTransport, AdapterCorrelationEnvelope } from '../../src/adapters/contracts.ts';
import {
  reconcileEventSequence,
  validateAdapterCorrelation,
  validateAdapterError,
  validateAdapterEventCorrelation,
  validateAdapterRequestCorrelation,
} from '../../src/adapters/contracts.ts';

const correlation: AdapterCorrelationEnvelope = {
  workflowId: 'workflow-1', planId: 'plan-1', operationId: 'op-1', snapshotId: 'snapshot-1', attemptId: 'attempt-1',
  source: 'fixture', sourceVersion: '1', observedAt: '2026-08-28T00:00:00.000Z',
};
const evidence = { source: 'fixture', observedAt: '2026-08-28T00:00:00.000Z', locator: 'controlled' };

function orcaFixture(crossRun = false, workerStatus = 'done'): ControlledTransport<any, unknown> {
  return {
    source: 'fixture', version: '1', request: async ({ kind, id, correlation: requestCorrelation }) => ({
      kind: 'known',
      evidence,
      value: kind === 'run'
        ? { runId: id, status: 'running', source: 'fixture', version: '1', observedAt: requestCorrelation.observedAt, correlation: requestCorrelation }
        : kind === 'task'
          ? { taskId: id, runId: crossRun ? 'run-other' : 'run-1', planId: 'plan-1', status: 'done', source: 'fixture', version: '1', observedAt: requestCorrelation.observedAt, correlation: requestCorrelation }
          : kind === 'dispatch'
            ? { dispatchId: id, runId: 'run-1', taskId: 'task-1', status: 'accepted', source: 'fixture', version: '1', observedAt: requestCorrelation.observedAt, correlation: requestCorrelation }
            : kind === 'worker'
              ? { workerId: id, runId: 'run-1', taskId: 'task-1', status: workerStatus, source: 'fixture', version: '1', observedAt: requestCorrelation.observedAt, correlation: requestCorrelation }
              : { deliveryId: id, dispatchId: 'dispatch-1', runId: 'run-1', taskId: 'task-1', status: 'delivered', source: 'fixture', version: '1', observedAt: requestCorrelation.observedAt, correlation: requestCorrelation },
    }),
  };
}

describe('controlled Orca adapter', () => {
  test('associates five stable objects without dispatch side effects', async () => {
    const adapter = new ControlledOrcaAdapter(orcaFixture(), correlation);
    const result = await adapter.observe({ runId: 'run-1', taskId: 'task-1', dispatchId: 'dispatch-1', workerId: 'worker-1', deliveryId: 'delivery-1' });
    expect(result.kind).toBe('known');
  });

  test('does not accept duplicate delivery or out-of-order events twice', async () => {
    const adapter = new ControlledOrcaAdapter(orcaFixture(), correlation);
    const input = { runId: 'run-1', taskId: 'task-1', dispatchId: 'dispatch-1', workerId: 'worker-1', deliveryId: 'delivery-1' };
    expect((await adapter.observe(input)).kind).toBe('known');
    const duplicate = await adapter.observe(input);
    expect(duplicate).toMatchObject({ kind: 'unknown', reasonCode: 'orca.delivery.duplicate' });
    const late = await adapter.observe({ ...input, deliveryId: 'delivery-2', previousEvent: { ...correlation, eventId: 'event-2', sequence: 2 }, event: { ...correlation, eventId: 'event-1', sequence: 1 } });
    expect(late).toMatchObject({ kind: 'unknown', reasonCode: 'adapter.event.out-of-order' });
  });

  test('keeps accepted-but-not-executed and disconnected observations unknown', async () => {
    const pending = new ControlledOrcaAdapter(orcaFixture(false, 'pending'), correlation);
    const input = { runId: 'run-1', taskId: 'task-1', dispatchId: 'dispatch-1', workerId: 'worker-1', deliveryId: 'delivery-1' };
    expect(await pending.observe(input)).toMatchObject({ kind: 'unknown', reasonCode: 'orca.dispatch.accepted-not-executed' });
    const disconnected = new ControlledOrcaAdapter({ source: 'fixture', version: '1', request: async () => ({ kind: 'unknown', reasonCode: 'orca.disconnected', observedAt: correlation.observedAt, recovery: 'retry' }) }, correlation);
    expect(await disconnected.observe(input)).toMatchObject({ kind: 'unknown', reasonCode: 'orca.observation.incomplete' });
  });
  test('returns unknown for cross-run identity mismatch and malformed response', async () => {
    const adapter = new ControlledOrcaAdapter(orcaFixture(true), correlation);
    const result = await adapter.observe({ runId: 'run-1', taskId: 'task-1', dispatchId: 'dispatch-1', workerId: 'worker-1', deliveryId: 'delivery-1' });
    expect(result.kind).toBe('unknown');
    const malformed = new ControlledOrcaAdapter({ source: 'fixture', version: '1', request: async () => ({ kind: 'known', value: {}, evidence }) }, correlation);
    expect((await malformed.getRun('run-1')).kind).toBe('unknown');
  });
});

describe('controlled GitHub adapter', () => {
  test('reads allowlisted pull request and blocks head drift', async () => {
    const transport: ControlledTransport<any, unknown> = {
      source: 'fixture', version: '1', request: async (request) => ({ kind: 'known', evidence, value: request.kind === 'pull-request'
        ? { owner: request.owner, repository: request.repository, number: request.number, state: 'open', baseSha: '1111111111111111', headSha: '2222222222222222', source: 'fixture', version: '1', observedAt: correlation.observedAt, correlation }
        : { owner: request.owner, repository: request.repository, number: request.number, expectedHead: '2222222222222222', conclusion: 'success', source: 'fixture', version: '1', observedAt: correlation.observedAt, correlation } }),
    };
    const adapter = new ControlledGithubAdapter(transport, correlation);
    const ref = { owner: 'owner', repository: 'repo', number: 1 };
    expect((await adapter.getPullRequest(ref)).kind).toBe('known');
    expect((await adapter.getChecks(ref, '3333333333333333')).kind).toBe('unknown');
  });
  test('maps unavailable transport and malformed response to unknown', async () => {
    const unavailable: ControlledTransport<any, unknown> = { source: 'fixture', version: '1', request: async () => { throw new Error('offline'); } };
    const adapter = new ControlledGithubAdapter(unavailable, correlation);
  });
});

describe('controlled Host adapter', () => {
  test('preserves supported capability and honest unsupported result', async () => {
    const adapter = new ControlledHostAdapter({ source: 'fixture', version: '1', request: async (input) => ({
      status: 'supported', hostId: input.hostId, hostVersion: input.hostVersion,
      evidence: { ...evidence, hostId: input.hostId, hostVersion: input.hostVersion },
    }) });
    expect((await adapter.probe({ hostId: 'omp', hostVersion: '1' })).status).toBe('supported');
  });
  test('returns unknown for malformed capability response', async () => {
    const adapter = new ControlledHostAdapter({ source: 'fixture', version: '1', request: async () => ({ status: 'supported' }) });
    expect((await adapter.probe({ hostId: 'codex', hostVersion: '1' })).status).toBe('unknown');
  });
});

describe('adapter correlation and errors', () => {
  test('validates request/event envelopes and rejects duplicate or late events', () => {
    const request = { ...correlation, requestId: 'request-1' };
    const event = { ...correlation, eventId: 'event-1', sequence: 2 };
    expect(validateAdapterCorrelation(correlation)).toBe(true);
    expect(validateAdapterRequestCorrelation(request)).toBe(true);
    expect(validateAdapterEventCorrelation(event)).toBe(true);
    expect(reconcileEventSequence(event, { ...event })).toMatchObject({ kind: 'stale', code: 'adapter.event.duplicate' });
    expect(reconcileEventSequence(event, { ...event, eventId: 'event-2', sequence: 1 })).toMatchObject({ kind: 'stale', code: 'adapter.event.out-of-order' });
  });

  test('validates typed adapter errors with retry and authorization scope', () => {
    expect(validateAdapterError({ kind: 'timeout', code: 'timeout', timeoutMs: 100, retryable: true })).toBe(true);
    expect(validateAdapterError({ kind: 'permission-denied', code: 'denied', retryable: false, authorizationScope: 'read' })).toBe(true);
    expect(validateAdapterError({ kind: 'permission-denied', code: 'denied', retryable: true, authorizationScope: 'read' })).toBe(false);
  });
});
