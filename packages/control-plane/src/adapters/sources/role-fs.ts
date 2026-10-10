import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import type { CapabilityReference } from '../../domain/capability';
import type { Availability, DefaultMarker, ScopeBoundary } from '../../domain/configuration';
import { validateSupplyRelativeRef } from '../../cli/supply-root';

export interface RoleSource {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly sourceRef: string;
  readonly digest: string;
  readonly capabilities: readonly CapabilityReference[];
}

export interface RoleCandidate {
  readonly configName: string;
  readonly defaultMarker: DefaultMarker;
  readonly scopeBoundary: ScopeBoundary;
  readonly availability: Availability;
  readonly capabilities: readonly CapabilityReference[];
}

function fail(message: string): never {
  throw new Error(`role source invalid: ${message}`);
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) fail(`${field} must be a non-empty string`);
  return value.trim();
}

function declaredPaths(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) fail(`${field} must be an array of non-empty strings`);
  return value.map((item) => (item as string).trim());
}

function relativeRolePath(roleRef: string, value: string): string {
  const rolePath = path.posix.normalize(roleRef.replaceAll('\\', '/')).replace(/^\.\//u, '').replace(/\/$/u, '');
  const contentPath = path.posix.normalize(value.replaceAll('\\', '/')).replace(/^\.\//u, '');
  if (contentPath === '.' || contentPath.startsWith('../') || contentPath.includes('/../') || contentPath.startsWith('/')) fail(`${value} escapes role source`);
  const joined = path.posix.join(rolePath, contentPath);
  if (rolePath.length === 0 || !joined.startsWith(`${rolePath}/`)) fail(`${value} escapes role source`);
  return joined;
}

function sha256(value: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function fingerprintFile(filePath: string): Promise<string> {
  return sha256(await readFile(filePath));
}

async function fingerprintDirectory(directory: string): Promise<string> {
  const hash = createHash('sha256');
  const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    hash.update(entry.name);
    if (entry.isDirectory()) hash.update(await fingerprintDirectory(entryPath));
    else hash.update(await readFile(entryPath));
  }
  return `sha256:${hash.digest('hex')}`;
}

async function resolveRoleFile(supplyRoot: string, roleRef: string, declared: string): Promise<{ readonly relative: string; readonly absolute: string }> {
  const relative = relativeRolePath(roleRef, declared);
  const verdict = validateSupplyRelativeRef(relative, supplyRoot);
  if (!verdict.ok) fail(`content reference ${relative} is not inside the supply root`);
  try {
    const stat = await lstat(verdict.path);
    if (!stat.isFile()) fail(`content reference is not a file: ${relative}`);
  } catch {
    fail(`content file does not exist: ${relative}`);
  }
  return { relative, absolute: verdict.path };
}

async function resolveRoleDirectory(supplyRoot: string, roleRef: string, declared: string): Promise<{ readonly relative: string; readonly absolute: string }> {
  const relative = relativeRolePath(roleRef, declared);
  const verdict = validateSupplyRelativeRef(relative, supplyRoot);
  if (!verdict.ok) fail(`skill reference ${relative} is not inside the supply root`);
  try {
    const stat = await lstat(verdict.path);
    if (!stat.isDirectory()) fail(`skill reference is not a directory: ${relative}`);
    await lstat(path.join(verdict.path, 'SKILL.md'));
  } catch {
    fail(`skill directory or SKILL.md does not exist: ${relative}`);
  }
  return { relative, absolute: verdict.path };
}

export async function loadRoleSource(supplyRoot: string, roleRef: string): Promise<RoleSource> {
  const normalizedRoleRef = roleRef.trim().replaceAll('\\', '/').replace(/\/$/u, '');
  const roleVerdict = validateSupplyRelativeRef(normalizedRoleRef, supplyRoot);
  if (!roleVerdict.ok) fail(`role reference is not inside the supply root: ${roleRef}`);
  let roleStat;
  try { roleStat = await lstat(roleVerdict.path); } catch { fail(`role directory does not exist: ${normalizedRoleRef}`); }
  if (!roleStat.isDirectory()) fail(`role reference is not a directory: ${normalizedRoleRef}`);

  const roleTomlPath = path.join(roleVerdict.path, 'role.toml');
  let roleToml: Record<string, unknown>;
  try { roleToml = Bun.TOML.parse(await readFile(roleTomlPath, 'utf8')) as Record<string, unknown>; } catch (error) { fail(`role.toml cannot be parsed: ${error instanceof Error ? error.message : String(error)}`); }
  const id = stringField(roleToml.id, 'id');
  const name = stringField(roleToml.name, 'name');
  const version = stringField(roleToml.version, 'version');
  const contents = roleToml.contents;
  if (typeof contents !== 'object' || contents === null || Array.isArray(contents)) fail('contents must be a table');
  const contentTable = contents as Record<string, unknown>;
  const memoryPaths = declaredPaths(contentTable.memory, 'contents.memory');
  const promptPaths = declaredPaths(contentTable.prompts, 'contents.prompts');
  const skillPaths = declaredPaths(contentTable.skills, 'contents.skills');
  const capabilities: CapabilityReference[] = [];
  const seen = new Set<string>();
  const addCapability = async (kind: CapabilityReference['kind'], nameValue: string, relative: string, fingerprint: string): Promise<void> => {
    const nameKey = `${kind}:${nameValue}`;
    if (seen.has(nameKey)) fail(`duplicate capability: ${nameKey}`);
    seen.add(nameKey);
    capabilities.push({ kind, name: nameValue, source: 'project-capability', summary: `${id} ${kind}: ${nameValue}`, sourceRef: relative, contentFingerprint: fingerprint });
  };

  for (const declared of [...memoryPaths, ...promptPaths]) {
    const resolved = await resolveRoleFile(supplyRoot, normalizedRoleRef, declared);
    await addCapability('instruction', `${id}:${path.posix.basename(resolved.relative)}`, resolved.relative, await fingerprintFile(resolved.absolute));
  }
  for (const declared of skillPaths) {
    const resolved = await resolveRoleDirectory(supplyRoot, normalizedRoleRef, declared);
    await addCapability('skill', path.posix.basename(resolved.relative), resolved.relative, await fingerprintDirectory(resolved.absolute));
  }
  if (capabilities.length === 0) fail('contents must declare at least one memory, prompt, or skill');

  const roleDigest = sha256(JSON.stringify({ roleToml, capabilities }));
  return { id, name, version, sourceRef: normalizedRoleRef, digest: roleDigest, capabilities };
}

export function buildRoleCandidate(configName: string, role: RoleSource): RoleCandidate {
  return {
    configName,
    defaultMarker: { kind: 'unknown', reason: `role:${role.id}:not-default`, observedAt: new Date().toISOString() },
    scopeBoundary: { kind: 'known', value: `role:${role.id}@${role.version} ${role.digest}` },
    availability: { kind: 'known', value: 'resolved' },
    capabilities: role.capabilities,
  };
}
