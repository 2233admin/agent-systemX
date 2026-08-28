import { describe, expect, test } from 'bun:test';
import { OrcaCliExecutionAdapter, type OrcaCommandResult } from '../../src/adapters/orca/orca-cli-execution-adapter.ts';

const request = {
  runId: 'run-1', taskId: 'task-1', objective: 'run one safe worker task', worktreePath: 'D:/worker/worktree', branch: 'feature/run-slice',
  baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', revisionId: 'rev-1', client: 'omp' as const,
};

function completedWorkerResponse() {
  return { exitCode: 0, stdout: JSON.stringify({ id: 'rpc-response-id', ok: true, result: { dispatch: { id: 'dispatch-1', task_id: 'task-1', run_id: 'run-1', status: 'completed' }, worker: { state: 'succeeded', worktree_id: request.worktreePath }, terminal: { worktreePath: request.worktreePath, branch: request.branch } } }), stderr: '' };
}

test('validates the pre-created task objective then reads exact dispatch receipts', async () => {
  const calls: string[][] = [];
  const responses: OrcaCommandResult[] = [
    { exitCode: 0, stdout: JSON.stringify({ result: { runId: 'run-1', tasks: [{ id: 'task-1', spec: request.objective }] } }), stderr: '' },
    { exitCode: 0, stdout: JSON.stringify({ result: { runId: 'run-1', taskId: 'task-1', dispatchId: 'dispatch-1', status: 'accepted' } }), stderr: '' },
    completedWorkerResponse(),
    { exitCode: 0, stdout: JSON.stringify({ result: { dispatchId: 'dispatch-1', runId: 'run-1', taskId: 'task-1' } }), stderr: '' },
  ];
  const adapter = new OrcaCliExecutionAdapter('orca', async (_command, args) => { calls.push([...args]); return responses.shift()!; }, 0, 100);

  const result = await adapter.runWorker(request);

  expect(result.kind).toBe('known');
  if (result.kind === 'known') expect(result.value).toMatchObject({ runId: 'run-1', taskId: 'task-1', dispatchId: 'dispatch-1', status: 'completed', worktreePath: request.worktreePath, branch: request.branch });
  expect(calls[0]).toEqual(['orchestration', 'task-list', '--run', 'run-1', '--json']);
  expect(calls[1]).toEqual(['orchestration', 'worker-start', '--run', 'run-1', '--task', 'task-1', '--worktree', 'path:D:/worker/worktree', '--agent', 'omp', '--json']);
  expect(calls[2]).toEqual(['orchestration', 'worker-show', '--dispatch', 'dispatch-1', '--json']);
  expect(calls[3]).toEqual(['orchestration', 'worker-read', '--dispatch', 'dispatch-1', '--source', 'auto', '--limit', '1000', '--json']);
});

test('returns unknown when task objective is not bound to the assignment', async () => {
  const calls: string[][] = [];
  const adapter = new OrcaCliExecutionAdapter('orca', async (_command, args) => {
    calls.push([...args]);
    return { exitCode: 0, stdout: JSON.stringify({ result: { runId: 'run-1', tasks: [{ id: 'task-1', spec: 'different objective' }] } }), stderr: '' };
  }, 0, 100);
  await expect(adapter.runWorker(request)).resolves.toMatchObject({ kind: 'unknown', reasonCode: 'orca.task.objective-mismatch' });
  expect(calls).toHaveLength(1);
});

test('returns unknown when Orca is unavailable instead of reporting success', async () => {
  const adapter = new OrcaCliExecutionAdapter('orca', async () => { throw new Error('not available'); }, 0, 100);
  await expect(adapter.runWorker(request)).resolves.toMatchObject({ kind: 'unknown', reasonCode: 'orca.task-list.unavailable' });
});
test('accepts transcript-only worker-read when exact dispatch was already validated', async () => {
  const responses: OrcaCommandResult[] = [
    { exitCode: 0, stdout: JSON.stringify({ result: { runId: 'run-1', tasks: [{ id: 'task-1', spec: request.objective }] } }), stderr: '' },
    { exitCode: 0, stdout: JSON.stringify({ result: { runId: 'run-1', taskId: 'task-1', dispatchId: 'dispatch-1', status: 'accepted' } }), stderr: '' },
    completedWorkerResponse(),
    { exitCode: 0, stdout: JSON.stringify({ result: { source: 'transcript', status: { worker: 'succeeded' } } }), stderr: '' },
  ];
  const adapter = new OrcaCliExecutionAdapter('orca', async () => responses.shift()!, 0, 100);
  await expect(adapter.runWorker(request)).resolves.toMatchObject({ kind: 'known' });
});

test('rejects worker-read when an explicit dispatch identity mismatches', async () => {
  const responses: OrcaCommandResult[] = [
    { exitCode: 0, stdout: JSON.stringify({ result: { runId: 'run-1', tasks: [{ id: 'task-1', spec: request.objective }] } }), stderr: '' },
    { exitCode: 0, stdout: JSON.stringify({ result: { runId: 'run-1', taskId: 'task-1', dispatchId: 'dispatch-1', status: 'accepted' } }), stderr: '' },
    completedWorkerResponse(),
    { exitCode: 0, stdout: JSON.stringify({ result: { dispatchId: 'other-dispatch', runId: 'run-1', taskId: 'task-1' } }), stderr: '' },
  ];
  const adapter = new OrcaCliExecutionAdapter('orca', async () => responses.shift()!, 0, 100);
  await expect(adapter.runWorker(request)).resolves.toMatchObject({ kind: 'unknown', reasonCode: 'orca.worker-read.identity-mismatch' });
});
test('rejects a dispatch-only worker-read receipt when its explicit dispatch mismatches', async () => {
  const responses: OrcaCommandResult[] = [
    { exitCode: 0, stdout: JSON.stringify({ result: { runId: 'run-1', tasks: [{ id: 'task-1', spec: request.objective }] } }), stderr: '' },
    { exitCode: 0, stdout: JSON.stringify({ result: { runId: 'run-1', taskId: 'task-1', dispatchId: 'dispatch-1', status: 'accepted' } }), stderr: '' },
    completedWorkerResponse(),
    { exitCode: 0, stdout: JSON.stringify({ result: { dispatch_id: 'other-dispatch' } }), stderr: '' },
  ];
  const adapter = new OrcaCliExecutionAdapter('orca', async () => responses.shift()!, 0, 100);
  await expect(adapter.runWorker(request)).resolves.toMatchObject({ kind: 'unknown', reasonCode: 'orca.worker-read.identity-mismatch' });
});
test('rejects a task object bound to a different run', async () => {
  const adapter = new OrcaCliExecutionAdapter('orca', async () => ({
    exitCode: 0,
    stdout: JSON.stringify({ result: { runId: 'run-1', tasks: [{ id: 'task-1', run_id: 'run-2', spec: request.objective }] } }),
    stderr: '',
  }), 0, 100);
  await expect(adapter.runWorker(request)).resolves.toMatchObject({ kind: 'unknown', reasonCode: 'orca.task.identity-mismatch' });
});

test('rejects duplicate task matches instead of choosing the first', async () => {
  const adapter = new OrcaCliExecutionAdapter('orca', async () => ({
    exitCode: 0,
    stdout: JSON.stringify({ result: { runId: 'run-1', tasks: [{ id: 'task-1', spec: request.objective }, { id: 'task-1', spec: request.objective }] } }),
    stderr: '',
  }), 0, 100);
  await expect(adapter.runWorker(request)).resolves.toMatchObject({ kind: 'unknown', reasonCode: 'orca.task.ambiguous' });
});
