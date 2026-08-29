import type { ClientId } from '../../domain/client';
import type { ConfigurationRevision } from '../../domain/configuration';
import type { ProcessReference } from '../../domain/launch-observation';

export interface KnownText {
  readonly kind: 'known';
  readonly value: string;
}

export interface UnknownText {
  readonly kind: 'unknown';
  readonly reason: string;
  readonly observedAt: string;
}

export type ObservedText = KnownText | UnknownText;
export type CapabilityLevel = 'supported' | 'degraded' | 'unsupported' | 'unknown';

export interface ClientCapability {
  readonly level: CapabilityLevel;
  readonly version: ObservedText;
  readonly reason: string | undefined;
}

export interface PreparedActivation {
  readonly manifestHash: string;
  readonly context: Record<string, unknown>;
}

export interface StartedProcess {
  readonly processReference: ProcessReference;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly waitForExit?: Promise<{ readonly exitCode: number; readonly signal: string | null }>;
}

export interface ObservedLaunch {
  readonly outcome: 'succeeded' | 'degraded' | 'failed' | 'incomplete' | 'unknown' | 'not-available';
  readonly reason: string | undefined;
}

export interface ClientAdapterInput {
  readonly operationId: string;
  readonly revision: ConfigurationRevision;
}

export interface ClientAdapter {
  readonly clientId: ClientId;
  probe(input?: { readonly revision: ConfigurationRevision }): Promise<ClientCapability>;
  prepare(input: ClientAdapterInput): Promise<PreparedActivation>;
  start(input: ClientAdapterInput & { readonly prepared: PreparedActivation }): Promise<StartedProcess>;
  observe(input: ClientAdapterInput & { readonly started: StartedProcess }): Promise<ObservedLaunch>;
}

export interface ClientAdapterRegistry {
  get(clientId: ClientId): ClientAdapter | null;
}
