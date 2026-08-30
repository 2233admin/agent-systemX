import type { GateResult } from '../core/result.ts';
import type { DispatchDecision, DispatchInput } from '../gates/dispatch.ts';

export interface StatusQuery {
  readonly workflowId?: string;
}

export interface StatusPlanView {
  readonly id: string;
  readonly status: string;
  readonly lease: 'none' | 'execution';
}

export interface StatusView {
  readonly workflowId: string;
  readonly revision: number;
  readonly plans: readonly StatusPlanView[];
  readonly integrationMergeLease: 'none' | 'integration-merge';
}

export type ValidateQuery = DispatchInput;

export interface ValidationView {
  readonly result: GateResult<DispatchDecision>;
}
