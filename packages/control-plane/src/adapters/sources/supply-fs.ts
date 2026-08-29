import { createHash } from 'node:crypto';
import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import type { CapabilityReference } from '../../domain/capability';
import type { Availability, DefaultMarker, ScopeBoundary } from '../../domain/configuration';
import { validateSupplyRelativeRef } from '../../cli/supply-root';
import { SupplyDuplicateGroupError, SupplyDuplicateSkillNameError, SupplyGroupEmptyError, SupplyGroupNotFoundError, SupplyRootNotFoundError } from '../../application/establish';

export interface SupplyScanResult { readonly groupRefs: readonly string[]; readonly capabilities: readonly CapabilityReference[]; }
export interface SupplyCandidate { readonly configName: string; readonly defaultMarker: DefaultMarker; readonly scopeBoundary: ScopeBoundary; readonly availability: Availability; readonly capabilities: readonly CapabilityReference[]; readonly skills: readonly CapabilityReference[]; }

async function fingerprintDirectory(directory: string): Promise<string> {
  const hash = createHash('sha256');
  const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) hash.update(await fingerprintDirectory(entryPath));
    else hash.update(entry.name).update(await readFile(entryPath));
  }
  return hash.digest('hex');
}

export async function loadSupplyGroups(supplyRoot: string, groupNames: readonly string[]): Promise<SupplyScanResult> {
  let rootStat;
  try { rootStat = await lstat(supplyRoot); } catch { throw new SupplyRootNotFoundError(supplyRoot); }
  if (!rootStat.isDirectory()) throw new SupplyRootNotFoundError(supplyRoot);
  const seenGroups = new Map<string, string>();
  const seenSkills = new Map<string, string>();
  const capabilities: CapabilityReference[] = [];
  for (const declared of groupNames) {
    const verdict = validateSupplyRelativeRef(declared, supplyRoot);
    if (!verdict.ok) throw new SupplyGroupNotFoundError(declared, supplyRoot);
    const group = verdict.ref;
    if (seenGroups.has(group)) throw new SupplyDuplicateGroupError(group, seenGroups.get(group)!, declared);
    seenGroups.set(group, declared);
    const groupPath = path.join(supplyRoot, group);
    const skillsRoot = path.join(groupPath, 'skills');
    let entries;
    try { entries = await readdir(skillsRoot, { withFileTypes: true }); } catch { throw new SupplyGroupNotFoundError(group, supplyRoot); }
    const skills = entries.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    if (skills.length === 0) throw new SupplyGroupEmptyError(group, supplyRoot);
    for (const skill of skills) {
      const skillPath = path.join(skillsRoot, skill.name);
      try { await lstat(path.join(skillPath, 'SKILL.md')); } catch { continue; }
      if (seenSkills.has(skill.name)) throw new SupplyDuplicateSkillNameError(skill.name, seenSkills.get(skill.name)!, group);
      seenSkills.set(skill.name, group);
      const relative = `${group}/skills/${skill.name}`;
      const checked = validateSupplyRelativeRef(relative, supplyRoot);
      if (!checked.ok) throw new SupplyGroupNotFoundError(relative, supplyRoot);
      capabilities.push({ kind: 'skill', name: skill.name, source: 'project-capability', summary: `skill reference: ${skill.name}`, sourceRef: checked.ref, contentFingerprint: `sha256:${await fingerprintDirectory(skillPath)}` });
    }
  }
  if (capabilities.length === 0) throw new SupplyGroupEmptyError(groupNames[0] ?? '(none)', supplyRoot);
  return { groupRefs: [...seenGroups.keys()], capabilities };
}

export function buildSupplyCandidate(configName: string, scan: SupplyScanResult): SupplyCandidate {
  return { configName, defaultMarker: { kind: 'unknown', reason: 'not-decided-by-configs-supply', observedAt: new Date().toISOString() }, scopeBoundary: { kind: 'known', value: `configs supply: groups ${scan.groupRefs.join(', ')}` }, availability: { kind: 'known', value: 'resolved' }, capabilities: scan.capabilities, skills: scan.capabilities };
}
