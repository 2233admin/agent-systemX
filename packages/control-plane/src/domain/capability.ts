export type CapabilityKind = 'instruction' | 'skill' | 'mcp' | 'hook' | 'plugin';

export type CapabilitySource =
  | 'project-capability'
  | 'project-skill-import'
  | 'project-prompt'
  | 'unknown-source';

export interface CapabilityReference {
  readonly kind: CapabilityKind;
  readonly name: string;
  readonly source: CapabilitySource | undefined;
  readonly summary: string | undefined;
  readonly sourceRef: string | undefined;
  readonly contentFingerprint: string | undefined;
}

export const CAPABILITY_KINDS: readonly CapabilityKind[] = ['instruction', 'skill', 'mcp', 'hook', 'plugin'];

export function isCapabilityKind(value: unknown): value is CapabilityKind {
  return typeof value === 'string' && CAPABILITY_KINDS.includes(value as CapabilityKind);
}

export function validateCapabilityReference(reference: CapabilityReference): void {
  if (typeof reference !== 'object' || reference === null) throw new Error('capability reference must be an object');
  if (!isCapabilityKind(reference.kind)) throw new Error(`invalid capability kind: ${String(reference.kind)}`);
  if (typeof reference.name !== 'string' || reference.name.trim().length === 0) throw new Error('capability name must not be empty');
  if (reference.source !== undefined && !['project-capability', 'project-skill-import', 'project-prompt', 'unknown-source'].includes(reference.source)) throw new Error(`invalid capability source: ${String(reference.source)}`);
  for (const [field, value] of Object.entries(reference)) {
    if (value !== undefined && typeof value !== 'string' && field !== 'kind') throw new Error(`capability ${field} must be a string when provided`);
  }
}
export function normalizeCapabilityReference(value: unknown): CapabilityReference {
  if (typeof value !== 'object' || value === null) throw new Error('capability reference must be an object');
  const input = value as Record<string, unknown>;
  const reference = {
    kind: input.kind,
    name: input.name,
    source: input.source,
    summary: input.summary,
    sourceRef: input.sourceRef,
    contentFingerprint: input.contentFingerprint,
  } as CapabilityReference;
  validateCapabilityReference(reference);
  return reference;
}
