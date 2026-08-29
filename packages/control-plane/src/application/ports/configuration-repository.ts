import type { ConfigurationRevision } from '../../domain/configuration';

export interface ConfigurationRepository {
  listAll(): Promise<readonly ConfigurationRevision[]>;
  findById(revisionId: string): Promise<ConfigurationRevision | null>;
}

export interface ConfigurationSearchResult {
  readonly revisionId: string;
  readonly configName: string;
  readonly triggerCategory: ConfigurationRevision['triggerCategory'];
  readonly rank: number;
}

export interface ConfigurationSearchRepository {
  search(query: string, limit: number): Promise<readonly ConfigurationSearchResult[]>;
  rebuild(): Promise<void>;
}

export interface ConfigurationRevisionWriter {
  create(params: {
    readonly triggerCategory: ConfigurationRevision['triggerCategory'];
    readonly evidenceRef: string;
    readonly candidate: unknown;
    readonly supersedesRevisionId: string | null;
  }): Promise<ConfigurationRevision>;
}
