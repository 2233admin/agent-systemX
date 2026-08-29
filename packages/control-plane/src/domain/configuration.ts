import { type CapabilityReference, validateCapabilityReference } from './capability';

export type ConfigurationName = string & { readonly __configurationName: unique symbol };
export type ConfigurationRevisionId = string & { readonly __configurationRevisionId: unique symbol };

export interface UnknownValue {
  readonly kind: 'unknown';
  readonly reason: string;
  readonly observedAt: string;
}

export type DefaultMarker = { readonly kind: 'known'; readonly value: boolean } | UnknownValue;
export type ScopeBoundary = { readonly kind: 'known'; readonly value: string } | UnknownValue;
export type Availability = { readonly kind: 'known'; readonly value: 'resolved' } | UnknownValue;

export interface ConfigurationRevision {
  readonly configName: ConfigurationName;
  readonly revisionId: ConfigurationRevisionId;
  readonly schemaVersion: number;
  readonly defaultMarker: DefaultMarker;
  readonly scopeBoundary: ScopeBoundary;
  readonly availability: Availability;
  readonly capabilities: readonly CapabilityReference[];
  readonly createdAt: string;
  readonly triggerCategory: 'new-scenario' | 'known-insufficiency' | 'bad-case';
  readonly evidenceRef: string;
  readonly supersedesRevisionId: ConfigurationRevisionId | null;
}

export function configurationName(value: string): ConfigurationName {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error('configuration name must not be empty');
  return trimmed as ConfigurationName;
}

export function configurationRevisionId(value: string): ConfigurationRevisionId {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error('configuration revision id must not be empty');
  return trimmed as ConfigurationRevisionId;
}

export function validateConfigurationRevision(revision: ConfigurationRevision): void {
  if (typeof revision.configName !== 'string' || revision.configName.trim().length === 0) throw new Error('configuration name must not be empty');
  if (typeof revision.revisionId !== 'string' || revision.revisionId.trim().length === 0) throw new Error('configuration revision id must not be empty');
  if (!Number.isInteger(revision.schemaVersion) || revision.schemaVersion < 1) throw new Error('schema version must be a positive integer');
  if (!Array.isArray(revision.capabilities)) throw new Error('capabilities must be an array');
  if (!['new-scenario', 'known-insufficiency', 'bad-case'].includes(revision.triggerCategory)) throw new Error('trigger category is invalid');
  if (typeof revision.createdAt !== 'string' || revision.createdAt.trim().length === 0) throw new Error('createdAt must not be empty');
  if (typeof revision.evidenceRef !== 'string' || revision.evidenceRef.trim().length === 0) throw new Error('evidenceRef must not be empty');
  if (revision.supersedesRevisionId === revision.revisionId) throw new Error('revision cannot supersede itself');
  validateFact(revision.defaultMarker, 'default marker', (value): value is boolean => typeof value === 'boolean');
  validateFact(revision.scopeBoundary, 'scope boundary', (value): value is string => typeof value === 'string' && value.trim().length > 0);
  validateFact(revision.availability, 'availability', (value): value is 'resolved' => value === 'resolved');
  const seen = new Set<string>();
  for (const capability of revision.capabilities) {
    validateCapabilityReference(capability);
    const key = `${capability.kind}:${capability.name}`;
    if (seen.has(key)) throw new Error(`duplicate capability reference: ${key}`);
    seen.add(key);
  }
}

function validateFact<T>(value: { readonly kind: string; readonly value?: unknown; readonly reason?: string; readonly observedAt?: string }, label: string, isKnownValue: (value: unknown) => value is T): void {
  if (value.kind === 'known') {
    if (!isKnownValue(value.value)) throw new Error(`${label} known value is invalid`);
    return;
  }
  if (value.kind !== 'unknown' || typeof value.reason !== 'string' || value.reason.trim().length === 0 || typeof value.observedAt !== 'string' || value.observedAt.trim().length === 0) throw new Error(`${label} unknown value is invalid`);
}

export interface SupersedesChain {
  readonly revisionId: ConfigurationRevisionId;
  readonly predecessors: readonly ConfigurationRevisionId[];
  readonly successors: readonly ConfigurationRevisionId[];
  readonly danglingPredecessorId: ConfigurationRevisionId | null;
  readonly danglingSuccessorId: ConfigurationRevisionId | null;
}

export function buildSupersedesChain(revisions: readonly ConfigurationRevision[], revisionId: ConfigurationRevisionId): SupersedesChain {
  const byId = new Map(revisions.map((revision) => [revision.revisionId, revision]));
  const successorOf = new Map<ConfigurationRevisionId, ConfigurationRevisionId>();
  for (const revision of revisions) {
    if (revision.supersedesRevisionId !== null) successorOf.set(revision.supersedesRevisionId, revision.revisionId);
  }
  const predecessors: ConfigurationRevisionId[] = [];
  let danglingPredecessorId: ConfigurationRevisionId | null = null;
  const predecessorVisited = new Set<ConfigurationRevisionId>([revisionId]);
  let current = byId.get(revisionId);
  while (current?.supersedesRevisionId !== null && current !== undefined) {
    const nextId = current.supersedesRevisionId;
    if (predecessorVisited.has(nextId)) break;
    if (!byId.has(nextId)) { danglingPredecessorId = nextId; break; }
    predecessors.unshift(nextId);
    predecessorVisited.add(nextId);
    current = byId.get(nextId);
  }
  const successors: ConfigurationRevisionId[] = [];
  let danglingSuccessorId: ConfigurationRevisionId | null = null;
  const successorVisited = new Set<ConfigurationRevisionId>([revisionId]);
  let currentId = revisionId;
  while (successorOf.has(currentId)) {
    const nextId = successorOf.get(currentId)!;
    if (successorVisited.has(nextId)) break;
    if (!byId.has(nextId)) { danglingSuccessorId = nextId; break; }
    successors.push(nextId);
    successorVisited.add(nextId);
    currentId = nextId;
  }
  return { revisionId, predecessors, successors, danglingPredecessorId, danglingSuccessorId };
}

