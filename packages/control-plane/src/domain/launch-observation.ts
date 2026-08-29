import type { ClientId } from './client';

export type LaunchObservationStage = 'process-started' | 'context-written' | 'process-exited' | 'outcome-observed';
export type LaunchObservationOutcome = 'succeeded' | 'degraded' | 'failed' | 'incomplete' | 'unknown' | 'not-available';

export interface ProcessReference {
  readonly pid?: number;
  readonly token?: string;
}

export interface LaunchObservation {
  readonly observationId: string;
  readonly operationId: string;
  readonly clientId: ClientId;
  readonly stage: LaunchObservationStage;
  readonly outcome: LaunchObservationOutcome;
  readonly processReference: ProcessReference | undefined;
  readonly reason: string | undefined;
  readonly observedAt: string;
}

export function createLaunchObservation(params: Omit<LaunchObservation, 'observationId'> & { readonly observationId?: string }): LaunchObservation {
  return { ...params, observationId: params.observationId ?? crypto.randomUUID() };
}
