import type { EvidenceRef, Violation } from '../core/result.ts';
import { evaluate, evidenceFrom, finding, isRecord, nonEmpty, readEvidence } from './helpers.ts';
import type { QualityEvaluation, QualityFinding, QualityKnowledge } from './types.ts';

export interface PluginManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly skills: string;
  readonly author?: unknown;
  readonly repository?: unknown;
}

export interface PluginFile {
  readonly path: string;
  readonly content: string;
}

export interface SkillAuthoringInput {
  readonly path: string;
  readonly content: string;
  readonly evidence?: EvidenceRef;
  readonly sourceAvailable?: boolean;
}

export interface PluginValidationInput {
  readonly root: string;
  readonly pluginId?: string;
  readonly version?: string;
  readonly manifests: Readonly<{ claude?: unknown; codex?: unknown }>;
  readonly files: readonly PluginFile[];
  readonly evidence?: EvidenceRef;
  readonly sourceAvailable?: boolean;
}

export interface PluginValidation {
  readonly pluginId: string;
  readonly version: string;
  readonly status: 'valid' | 'invalid' | 'unknown';
  readonly findings: readonly QualityFinding[];
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly knowledge?: QualityKnowledge;
  readonly violations: readonly Violation[];
}

function manifestValue(value: unknown): PluginManifest | null {
  if (!isRecord(value) || !nonEmpty(value.name) || !nonEmpty(value.version) || !nonEmpty(value.description)) return null;
  if (value.skills !== './skills/') return null;
  return value as unknown as PluginManifest;
}

function unsupportedManifest(value: unknown): boolean {
  return isRecord(value) && value.skills !== undefined && value.skills !== './skills/';
}

function frontmatter(content: string): { readonly name?: string; readonly description?: string } | null {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) return null;
  const result: { name?: string; description?: string } = {};
  for (const line of lines.slice(1, end)) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key === 'name') result.name = value;
    if (key === 'description') result.description = value;
  }
  return result;
}

function validInput(value: unknown): PluginValidationInput | null {
  if (!isRecord(value) || !nonEmpty(value.root) || !isRecord(value.manifests) || !Array.isArray(value.files)) return null;
  const evidence = evidenceFrom(value.evidence);
  return {
    root: value.root,
    ...(typeof value.pluginId === 'string' ? { pluginId: value.pluginId } : {}),
    ...(typeof value.version === 'string' ? { version: value.version } : {}),
    manifests: value.manifests,
    files: value.files as PluginFile[],
    ...(evidence === undefined ? {} : { evidence }),
    ...(value.sourceAvailable === false ? { sourceAvailable: false } : {}),
  };
}

export function validatePluginPackage(value: unknown): PluginValidation {
  const input = validInput(value);
  const { evidence, sourceAvailable } = readEvidence(value);
  const pluginId = input?.pluginId ?? 'unknown-plugin';
  const version = input?.version ?? 'unknown-version';
  if (input === null || input.files.some((file) => !isRecord(file) || !nonEmpty(file.path) || typeof file.content !== 'string')) {
    return toPluginValidation(pluginId, version, 'invalid', [finding('plugin.input.invalid', 'error', 'plugin', evidence)], evidence);
  }
  if (!sourceAvailable) return toPluginValidation(pluginId, version, 'unknown', [], evidence, 'plugin.source.unavailable');

  const findings: QualityFinding[] = [];
  const claude = manifestValue(input.manifests.claude);
  const codex = manifestValue(input.manifests.codex);
  if (unsupportedManifest(input.manifests.claude) || unsupportedManifest(input.manifests.codex)) {
    findings.push(finding('plugin.manifest.unsupported', 'error', input.root, input.evidence, 'plugin-use-supported-layout'));
  } else if (claude === null || codex === null) {
    findings.push(finding('plugin.manifest.portable.missing', 'error', input.root, input.evidence, 'plugin.add-portable-manifest'));
  }
  if (claude !== null && codex !== null) {
    if (claude.name !== codex.name || claude.version !== codex.version || claude.description !== codex.description || claude.skills !== codex.skills) {
      findings.push(finding('plugin.manifest.identity-mismatch', 'error', input.root, input.evidence, 'plugin.align-manifests'));
    }
    if (input.pluginId !== undefined && (claude.name !== input.pluginId || codex.name !== input.pluginId)) {
      findings.push(finding('plugin.manifest.identity-mismatch', 'error', input.root, input.evidence, 'plugin.align-manifests'));
    }
    if (input.version !== undefined && (claude.version !== input.version || codex.version !== input.version)) {
      findings.push(finding('plugin.manifest.version-mismatch', 'error', input.root, input.evidence, 'plugin.align-version'));
    }
  }

  const skillNames = new Set<string>();
  for (const file of input.files) {
    const normalizedPath = file.path.replaceAll('\\', '/');
    if (!normalizedPath.startsWith('skills/') || !normalizedPath.endsWith('/SKILL.md')) continue;
    const metadata = frontmatter(file.content);
    if (metadata === null || !nonEmpty(metadata.name) || !nonEmpty(metadata.description)) {
      findings.push(finding('skill.frontmatter.invalid', 'error', file.path, input.evidence, 'skill.add-frontmatter'));
      continue;
    }
    if (skillNames.has(metadata.name)) findings.push(finding('skill.name.duplicate', 'error', file.path, input.evidence, 'skill.rename-duplicate'));
    skillNames.add(metadata.name);
    if (/(?:^|[\s("'])\/(?:Users|home)\b|(?:^|[\s("'])[A-Za-z]:[\\/]/.test(file.content)) {
      findings.push(finding('skill.reference.absolute', 'error', file.path, input.evidence, 'skill-use-relative-reference'));
    }
  }

  const orderedFindings = [...findings].sort((left, right) => {
    const priority = (code: string): number => code === 'plugin.manifest.identity-mismatch' ? 0 : code === 'skill.name.duplicate' ? 1 : code === 'skill.reference.absolute' ? 2 : 3;
    return priority(left.code) - priority(right.code);
  });
  return toPluginValidation(pluginId, version, orderedFindings.length === 0 ? 'valid' : 'invalid', orderedFindings, input.evidence);
}

function toPluginValidation(
  pluginId: string,
  version: string,
  status: PluginValidation['status'],
  findings: readonly QualityFinding[],
  evidence: EvidenceRef | undefined,
  unknownReason?: string,
): PluginValidation {
  const evaluation = evaluate(status === 'valid' ? 'pass' : status === 'unknown' ? 'unknown' : 'invalid', findings, evidence, unknownReason);
  return {
    pluginId,
    version,
    status,
    findings,
    evidenceRefs: evaluation.evidenceRefs,
    ...(evaluation.knowledge === undefined ? {} : { knowledge: evaluation.knowledge }),
    violations: evaluation.violations,
  };
}
export function validateSkillAuthoring(value: unknown): QualityEvaluation {
  const record = isRecord(value) ? value : null;
  const evidence = evidenceFrom(record?.evidence);
  const sourceAvailable = record?.sourceAvailable !== false;
  if (!sourceAvailable) return evaluate('unknown', [], evidence, 'skill.source.unavailable');
  if (record === null || !nonEmpty(record.path) || typeof record.content !== 'string') {
    return evaluate('invalid', [finding('skill.input.invalid', 'error', 'skill', evidence, 'skill.fix-input')], evidence);
  }
  const metadata = frontmatter(record.content);
  const findings: QualityFinding[] = [];
  if (metadata === null || !nonEmpty(metadata.name) || !nonEmpty(metadata.description)) {
    findings.push(finding('skill.frontmatter.invalid', 'error', record.path, evidence, 'skill.add-frontmatter'));
  }
  if (/(?:^|[\s("'])\/(?:Users|home)\b|(?:^|[\s("'])[A-Za-z]:[\\/]/.test(record.content)) {
    findings.push(finding('skill.reference.absolute', 'error', record.path, evidence, 'skill-use-relative-reference'));
  }
  return evaluate(findings.length === 0 ? 'pass' : 'invalid', findings, evidence);
}

export const validatePlugin = validatePluginPackage;
export const validatePluginManifest = validatePluginPackage;
export const validateSkill = validateSkillAuthoring;
