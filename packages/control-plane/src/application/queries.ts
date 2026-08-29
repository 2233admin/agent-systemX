import type { ConfigurationRepository, ConfigurationSearchRepository, ConfigurationSearchResult } from './ports/configuration-repository';
import { buildSupersedesChain, type ConfigurationRevision, type SupersedesChain } from '../domain/configuration';
import { CAPABILITY_KINDS, type CapabilityKind } from '../domain/capability';

export class ConfigNotFoundError extends Error {
  readonly kind = 'config-not-found' as const;
  constructor(readonly revisionId: string) { super(`configuration revision not found: ${revisionId}`); this.name = 'ConfigNotFoundError'; }
}
export class ConfigUnsupportedError extends Error {
  readonly kind = 'config-unsupported' as const;
  constructor(readonly revisionId: string, readonly reason: string) { super(`configuration revision unsupported: ${revisionId} (${reason})`); this.name = 'ConfigUnsupportedError'; }
}
export type ConfigQueryError = ConfigNotFoundError | ConfigUnsupportedError;

export async function listConfigRevisions(repository: ConfigurationRepository): Promise<readonly ConfigurationRevision[]> { return repository.listAll(); }
export async function searchConfigRevisions(repository: ConfigurationSearchRepository, query: string, limit: number): Promise<readonly ConfigurationSearchResult[]> { return repository.search(query, limit); }
export async function rebuildConfigSearch(repository: ConfigurationSearchRepository): Promise<void> { await repository.rebuild(); }
export async function getConfigRevisionDetail(repository: ConfigurationRepository, revisionId: string): Promise<ConfigurationRevision> {
  const revision = await repository.findById(revisionId);
  if (revision === null) throw new ConfigNotFoundError(revisionId);
  return revision;
}
export async function getSupersedesChain(repository: ConfigurationRepository, revisionId: string): Promise<SupersedesChain> {
  const revision = await getConfigRevisionDetail(repository, revisionId);
  return buildSupersedesChain(await repository.listAll(), revision.revisionId);
}

export interface ComparisonResult {
  readonly revisionIds: readonly string[];
  readonly capabilities: Readonly<Record<CapabilityKind, readonly { readonly name: string; readonly presentIn: readonly string[]; readonly missingIn: readonly string[] }[]>>;
}

function compare(revisions: readonly ConfigurationRevision[]): ComparisonResult {
  const capabilities = {} as Record<CapabilityKind, readonly { readonly name: string; readonly presentIn: readonly string[]; readonly missingIn: readonly string[] }[]>;
  for (const kind of CAPABILITY_KINDS) {
    const names = new Set(revisions.flatMap((revision) => revision.capabilities.filter((item) => item.kind === kind).map((item) => item.name)));
    capabilities[kind] = [...names].sort().map((name) => ({ name, presentIn: revisions.filter((revision) => revision.capabilities.some((item) => item.kind === kind && item.name === name)).map((revision) => revision.revisionId), missingIn: revisions.filter((revision) => !revision.capabilities.some((item) => item.kind === kind && item.name === name)).map((revision) => revision.revisionId) }));
  }
  return { revisionIds: revisions.map((revision) => revision.revisionId), capabilities };
}

export interface CompareFailure { readonly revisionId: string; readonly error: ConfigQueryError; }
export interface CompareConfigRevisionsResult { readonly resolved: readonly ConfigurationRevision[]; readonly failed: readonly CompareFailure[]; readonly comparison: ComparisonResult | null; }
export async function compareConfigRevisions(repository: ConfigurationRepository, revisionIds: readonly string[]): Promise<CompareConfigRevisionsResult> {
  const resolved: ConfigurationRevision[] = [];
  const failed: CompareFailure[] = [];
  for (const revisionId of [...new Set(revisionIds)]) {
    try {
      const revision = await repository.findById(revisionId);
      if (revision === null) failed.push({ revisionId, error: new ConfigNotFoundError(revisionId) });
      else resolved.push(revision);
    } catch (error) {
      if (error instanceof ConfigUnsupportedError) failed.push({ revisionId, error });
      else throw error;
    }
  }
  return { resolved, failed, comparison: resolved.length === 0 ? null : compare(resolved) };
}
