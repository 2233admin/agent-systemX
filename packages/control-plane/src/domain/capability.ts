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
  if (!isCapabilityKind(reference.kind)) throw new Error(`invalid capability kind: ${String(reference.kind)}`);
  if (reference.name.trim().length === 0) throw new Error('capability name must not be empty');
  for (const [field, value] of Object.entries(reference)) {
    if (value !== undefined && typeof value !== 'string' && field !== 'kind') {
      throw new Error(`capability ${field} must be a string when provided`);
    }
  }
}
