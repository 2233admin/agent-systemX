import type { Unknown } from '../../core/result.ts';
import {
  evidenceForCorrelation,
  reconcileCorrelation,
  type AdapterCorrelationEnvelope,
  type ControlledTransport,
} from '../contracts.ts';
import {
  validateCoordinationDelivery,
  validateCoordinationDispatch,
  validateCoordinationRun,
  validateCoordinationTask,
  validateCoordinationWorker,
  validatePortResult,
  type CoordinationDeliveryDto,
  type CoordinationDispatchDto,
  type CoordinationRunDto,
  type CoordinationTaskDto,
  type CoordinationWorkerDto,
  type PortResult,
} from '../../ports/coordination.ts';

export interface OrcaObservationInput {
  readonly runId: string;
  readonly taskId: string;
  readonly dispatchId: string;
  readonly workerId: string;
  readonly deliveryId: string;
}

type OrcaRequest = {
  readonly kind: 'run' | 'task' | 'dispatch' | 'worker' | 'delivery';
  readonly id: string;
  readonly correlation: AdapterCorrelationEnvelope;
};

function unknown(reasonCode: string, observedAt: string, recovery: string): Unknown {
  return { kind: 'unknown', reasonCode, observedAt, recovery };
}

export class ControlledOrcaAdapter {
  public constructor(
    private readonly transport: ControlledTransport<OrcaRequest, unknown>,
    private readonly correlation: AdapterCorrelationEnvelope,
  ) {}

  public async getRun(runId: string): Promise<PortResult<CoordinationRunDto>> {
    return this.read('run', runId, validateCoordinationRun);
  }

  public async getTask(taskId: string): Promise<PortResult<CoordinationTaskDto>> {
    return this.read('task', taskId, validateCoordinationTask);
  }

  public async getDispatch(dispatchId: string): Promise<PortResult<CoordinationDispatchDto>> {
    return this.read('dispatch', dispatchId, validateCoordinationDispatch);
  }

  public async getWorker(workerId: string): Promise<PortResult<CoordinationWorkerDto>> {
    return this.read('worker', workerId, validateCoordinationWorker);
  }

  public async getDelivery(deliveryId: string): Promise<PortResult<CoordinationDeliveryDto>> {
    return this.read('delivery', deliveryId, validateCoordinationDelivery);
  }

  public async observe(input: OrcaObservationInput): Promise<PortResult<readonly [CoordinationRunDto, CoordinationTaskDto, CoordinationDispatchDto, CoordinationWorkerDto, CoordinationDeliveryDto]>> {
    const results = await Promise.all([
      this.getRun(input.runId),
      this.getTask(input.taskId),
      this.getDispatch(input.dispatchId),
      this.getWorker(input.workerId),
      this.getDelivery(input.deliveryId),
    ]);
    if (results.some((result) => result.kind !== 'known')) return unknown('orca.observation.incomplete', this.correlation.observedAt, 're-read all correlated Orca objects');
    const values = results.map((result) => result.kind === 'known' ? result.value : undefined);
    if (values.some((value) => value === undefined)) return unknown('orca.observation.incomplete', this.correlation.observedAt, 're-read all correlated Orca objects');
    const [run, task, dispatch, worker, delivery] = values as [CoordinationRunDto, CoordinationTaskDto, CoordinationDispatchDto, CoordinationWorkerDto, CoordinationDeliveryDto];
    if (task.runId !== undefined && task.runId !== run.runId
      || dispatch.runId !== undefined && dispatch.runId !== run.runId
      || worker.runId !== undefined && worker.runId !== run.runId
      || delivery.runId !== undefined && delivery.runId !== run.runId
      || delivery.dispatchId !== dispatch.dispatchId) {
      return unknown('orca.identity.cross-run-or-object-mismatch', this.correlation.observedAt, 'reconcile stable Orca IDs before accepting delivery');
    }
    return { kind: 'known', value: [run, task, dispatch, worker, delivery], evidence: evidenceForCorrelation(this.correlation, 'orca.controlled-observation') };
  }

  private async read<T>(kind: OrcaRequest['kind'], id: string, validate: (value: unknown) => value is T): Promise<PortResult<T>> {
    let response: unknown;
    try {
      response = await this.transport.request({ kind, id, correlation: this.correlation });
    } catch {
      return unknown('orca.transport.unavailable', this.correlation.observedAt, 'retry only after capability is re-probed');
    }
    try {
      const result = validatePortResult<T>(response, validate);
      if (result.kind === 'unknown') return result;
      const observedCorrelation = (result.value as T & { correlation?: unknown }).correlation;
      const mismatch = observedCorrelation === undefined ? null : reconcileCorrelation(this.correlation, observedCorrelation);
      if (mismatch !== null) return unknown(mismatch.code, this.correlation.observedAt, 'discard response and re-read the correlated object');
      return result;
    } catch {
      return unknown('orca.response.shape-invalid', this.correlation.observedAt, 'inspect only the allowlist DTO shape');
    }
  }
}

export type OrcaAdapter = ControlledOrcaAdapter;
