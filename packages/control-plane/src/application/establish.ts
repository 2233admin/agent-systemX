import type { CapabilityKind, CapabilityReference, CapabilitySource } from '../domain/capability';
import { isCapabilityKind, validateCapabilityReference } from '../domain/capability';
import { configurationName, configurationRevisionId, type Availability, type ConfigurationRevision, type DefaultMarker, type ScopeBoundary } from '../domain/configuration';

export class InvalidCandidateError extends Error {
  readonly kind = 'invalid-candidate' as const;
  constructor(readonly reason: string) { super(`candidate is invalid: ${reason}`); this.name = 'InvalidCandidateError'; }
}
export class InvalidTriggerCategoryError extends Error {
  readonly kind = 'invalid-trigger-category' as const;
  constructor(readonly received: string | undefined) { super(`trigger category is missing or invalid: ${received ?? '(none)'}`); this.name = 'InvalidTriggerCategoryError'; }
}
export class MissingEvidenceError extends Error {
  readonly kind = 'missing-evidence' as const;
  constructor() { super('evidence reference is required and must be non-empty'); this.name = 'MissingEvidenceError'; }
}
export class MissingSupersedesError extends Error {
  readonly kind = 'missing-supersedes' as const;
  constructor() { super('supersedes target revision id is required and must be non-empty'); this.name = 'MissingSupersedesError'; }
}
export class SupersedesNotFoundError extends Error {
  readonly kind = 'supersedes-not-found' as const;
  constructor(readonly revisionId: string) { super(`supersedes target revision "${revisionId}" was not found`); this.name = 'SupersedesNotFoundError'; }
}
export class SupersedesConfigMismatchError extends Error {
  readonly kind = 'supersedes-config-mismatch' as const;
  constructor(readonly revisionId: string, readonly expectedConfigName: string, readonly actualConfigName: string) { super(`supersedes target revision "${revisionId}" belongs to configName "${actualConfigName}", expected "${expectedConfigName}"`); this.name = 'SupersedesConfigMismatchError'; }
}
export class SupersedesConflictError extends Error {
  readonly kind = 'supersedes-conflict' as const;
  constructor(readonly revisionId: string) { super(`supersedes target revision "${revisionId}" has already been superseded`); this.name = 'SupersedesConflictError'; }
}
export class NoCandidateSourceError extends Error {
  readonly kind = 'no-candidate-source' as const;
  constructor() { super('no candidate source was provided'); this.name = 'NoCandidateSourceError'; }
}

export interface CandidateConfigRevision {
  readonly configName: string;
  readonly defaultMarker: DefaultMarker;
  readonly scopeBoundary: ScopeBoundary;
  readonly availability: Availability;
  readonly capabilities: readonly CapabilityReference[];
}

const TRIGGER_CATEGORIES = ['new-scenario', 'known-insufficiency', 'bad-case'] as const;
const CAPABILITY_SOURCES = ['project-capability', 'project-skill-import', 'project-prompt', 'unknown-source'] as const;
const MISSING_OBSERVED_AT = new Date(0).toISOString();

function parseState(raw: unknown, field: string, allowed: (value: unknown) => boolean, expected: string): { readonly kind: 'known'; readonly value: never } | { readonly kind: 'unknown'; readonly reason: string; readonly observedAt: string } {
  if (raw === undefined) return { kind: 'unknown', reason: `not-provided: ${field}`, observedAt: MISSING_OBSERVED_AT };
  if (typeof raw !== 'object' || raw === null || !('kind' in raw)) throw new InvalidCandidateError(`${field} must be a named observation object`);
  const value = raw as Record<string, unknown>;
  if (value.kind === 'unknown') {
    if (typeof value.reason !== 'string' || typeof value.observedAt !== 'string') throw new InvalidCandidateError(`${field} unknown state is malformed`);
    return { kind: 'unknown', reason: value.reason, observedAt: value.observedAt };
  }
  if (value.kind !== 'known' || !allowed(value.value)) throw new InvalidCandidateError(`${field} must contain ${expected}`);
  return { kind: 'known', value: value.value as never };
}

function parseCapability(raw: unknown, field: string): CapabilityReference {
  if (typeof raw !== 'object' || raw === null) throw new InvalidCandidateError(`${field} must be an object`);
  const value = raw as Record<string, unknown>;
  if (!isCapabilityKind(value.kind) || typeof value.name !== 'string' || value.name.trim().length === 0) throw new InvalidCandidateError(`${field} must contain a non-empty kind and name`);
  const source = value.source === undefined ? undefined : value.source;
  if (source !== undefined && (typeof source !== 'string' || !CAPABILITY_SOURCES.includes(source as CapabilitySource))) throw new InvalidCandidateError(`${field}.source is invalid`);
  for (const key of ['summary', 'sourceRef', 'contentFingerprint']) if (value[key] !== undefined && typeof value[key] !== 'string') throw new InvalidCandidateError(`${field}.${key} must be a string when provided`);
  const reference = { kind: value.kind as CapabilityKind, name: value.name, source: source as CapabilitySource | undefined, summary: value.summary as string | undefined, sourceRef: value.sourceRef as string | undefined, contentFingerprint: value.contentFingerprint as string | undefined };
  try { validateCapabilityReference(reference); } catch (error) { throw new InvalidCandidateError(`${field}: ${(error as Error).message}`); }
  return reference;
}

export function parseCandidateRevision(raw: unknown): CandidateConfigRevision {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new InvalidCandidateError('candidate must be an object');
  const object = raw as Record<string, unknown>;
  if (typeof object.configName !== 'string' || object.configName.trim().length === 0) throw new InvalidCandidateError('configName must be non-empty');
  const capabilitiesRaw = object.capabilities;
  if (!Array.isArray(capabilitiesRaw)) throw new InvalidCandidateError('capabilities must be an array');
  const capabilities = capabilitiesRaw.map((item, index) => parseCapability(item, `capabilities[${index}]`));
  const seen = new Set<string>();
  for (const capability of capabilities) { const key = `${capability.kind}:${capability.name}`; if (seen.has(key)) throw new InvalidCandidateError(`duplicate capability ${key}`); seen.add(key); }
  return {
    configName: object.configName.trim(),
    defaultMarker: parseState(object.defaultMarker, 'defaultMarker', (value) => typeof value === 'boolean', 'a boolean') as CandidateConfigRevision['defaultMarker'],
    scopeBoundary: parseState(object.scopeBoundary, 'scopeBoundary', (value) => typeof value === 'string', 'a string') as CandidateConfigRevision['scopeBoundary'],
    availability: parseState(object.availability, 'availability', (value) => value === 'resolved', 'resolved') as CandidateConfigRevision['availability'],
    capabilities,
  };
}

export function parseTriggerCategory(raw: string | undefined): ConfigurationRevision['triggerCategory'] {
  if (!TRIGGER_CATEGORIES.includes(raw as ConfigurationRevision['triggerCategory'])) throw new InvalidTriggerCategoryError(raw);
  return raw as ConfigurationRevision['triggerCategory'];
}
export function parseEvidenceRef(raw: string | undefined): string {
  const value = raw?.trim() ?? '';
  if (value.length === 0) throw new MissingEvidenceError();
  return value;
}
export function parseSupersedesRevisionId(raw: string | undefined): string {
  const value = raw?.trim() ?? '';
  if (value.length === 0) throw new MissingSupersedesError();
  return value;
}

export function createRevisionFromCandidate(candidate: CandidateConfigRevision, params: { readonly triggerCategory: ConfigurationRevision['triggerCategory']; readonly evidenceRef: string; readonly supersedesRevisionId: string | null; readonly revisionId?: string; readonly createdAt?: string }): ConfigurationRevision {
  const createdAt = params.createdAt ?? new Date().toISOString();
  const revision = {
    configName: configurationName(candidate.configName),
    revisionId: configurationRevisionId(params.revisionId ?? crypto.randomUUID()),
    schemaVersion: 1,
    defaultMarker: candidate.defaultMarker,
    scopeBoundary: candidate.scopeBoundary,
    availability: candidate.availability,
    capabilities: candidate.capabilities,
    createdAt,
    triggerCategory: params.triggerCategory,
    evidenceRef: params.evidenceRef,
    supersedesRevisionId: params.supersedesRevisionId === null ? null : configurationRevisionId(params.supersedesRevisionId),
  };
  return revision;
}

export class SupplyRootNotFoundError extends Error { readonly kind = 'supply-root-not-found' as const; constructor(readonly supplyRoot: string) { super(`supply library root does not exist: ${supplyRoot}`); } }
export class SupplyGroupNotFoundError extends Error { readonly kind = 'supply-group-not-found' as const; constructor(readonly group: string, readonly supplyRoot: string) { super(`supply group not found: ${group}`); } }
export class SupplyGroupEmptyError extends Error { readonly kind = 'supply-group-empty' as const; constructor(readonly group: string, readonly supplyRoot: string) { super(`supply group is empty: ${group}`); } }
export class SupplyDuplicateGroupError extends Error { readonly kind = 'supply-duplicate-group' as const; constructor(readonly groupRef: string, readonly firstDeclared: string, readonly secondDeclared: string) { super(`supply group declared twice: ${groupRef}`); } }
export class SupplyDuplicateSkillNameError extends Error { readonly kind = 'supply-duplicate-skill-name' as const; constructor(readonly skillName: string, readonly firstGroup: string, readonly secondGroup: string) { super(`skill name declared twice: ${skillName}`); } }
export class SupplySourceUnreadableError extends Error { readonly kind = 'supply-source-unreadable' as const; constructor(readonly sourceRef: string, readonly reason: string) { super(`supply source unreadable: ${sourceRef}`); } }
export class SupplyUnsupportedEntryError extends Error { readonly kind = 'supply-unsupported-entry' as const; constructor(readonly entry: string, readonly reason: string) { super(`unsupported supply entry: ${entry}`); } }
export class SupplyRefInvalidError extends Error { readonly kind = 'supply-ref-invalid' as const; constructor(readonly value: string, readonly supplyRoot: string, readonly why: string) { super(`invalid supply reference: ${value}`); } }
