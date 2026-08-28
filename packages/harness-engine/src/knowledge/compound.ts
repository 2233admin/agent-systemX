import type { EvidenceRef } from '../core/result.ts';
import { validateEvidenceRef } from '../core/result.ts';

export interface KnowledgeCrystal {
  readonly sourceRefs: readonly string[];
  readonly contentDigest: string;
  readonly overlapChecked: boolean;
  readonly discoverable: boolean;
  readonly evidence: readonly EvidenceRef[];
  readonly reasonCode?: string;
}

export interface KnowledgeOverlap {
  readonly overlap: boolean;
  readonly duplicateRefs: readonly string[];
}

export function checkKnowledgeOverlap(sourceRefs: readonly string[]): KnowledgeOverlap {
  const seen = new Set<string>();
  const duplicateRefs: string[] = [];
  for (const sourceRef of sourceRefs) {
    if (seen.has(sourceRef) && !duplicateRefs.includes(sourceRef)) duplicateRefs.push(sourceRef);
    seen.add(sourceRef);
  }
  return { overlap: duplicateRefs.length > 0, duplicateRefs };
}

export function createKnowledgeCrystal(sourceRefs: readonly string[], contentDigest: string, evidence: readonly EvidenceRef[]): KnowledgeCrystal {
  const overlap = checkKnowledgeOverlap(sourceRefs);
  try { evidence.forEach((item) => validateEvidenceRef(item)); } catch { return { sourceRefs: [], contentDigest: '', overlapChecked: false, discoverable: false, evidence: [], reasonCode: 'knowledge.evidence.invalid' }; }
  if (overlap.overlap || sourceRefs.length === 0 || !contentDigest.trim()) return { sourceRefs, contentDigest, overlapChecked: true, discoverable: false, evidence, reasonCode: overlap.overlap ? 'knowledge.source.overlap' : 'knowledge.source.missing' };
  return { sourceRefs, contentDigest, overlapChecked: true, discoverable: true, evidence };
}
