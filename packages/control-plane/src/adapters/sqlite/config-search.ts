import { Database } from 'bun:sqlite';

import { isKnown } from '../../domain/facts';
import type { CapabilityReference, StableConfigRevision } from '../../domain/config';
import type { ConfigSearchResult } from '../../application/ports';

const HAN_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{2ffff}]/u;
const WORD_RE = /[\p{L}\p{N}_]+/gu;

function isHan(value: string): boolean {
  return HAN_RE.test(value);
}

export function normalizeSearchText(value: string): string {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('und');
  const tokens: string[] = [];
  let hanRun = '';
  let nonHanRun = '';

  const flushHan = (): void => {
    const chars = [...hanRun];
    if (chars.length === 1) {
      tokens.push(chars[0]!);
    } else if (chars.length > 1) {
      for (let index = 0; index < chars.length - 1; index += 1) {
        tokens.push(chars[index]! + chars[index + 1]!);
      }
    }
    hanRun = '';
  };
  const flushNonHan = (): void => {
    const words = nonHanRun.match(WORD_RE);
    if (words !== null) {
      tokens.push(...words);
    }
    nonHanRun = '';
  };

  for (const character of normalized) {
    if (isHan(character)) {
      flushNonHan();
      hanRun += character;
    } else {
      flushHan();
      nonHanRun += character;
    }
  }
  flushHan();
  flushNonHan();
  return tokens.join(' ');
}

const PUBLIC_SCOPE_BOUNDARY_RE = /^(?:public(?:\s|:)|configs supply:\s+groups\b)/iu;

function publicScopeBoundary(revision: StableConfigRevision): string {
  if (!isKnown(revision.scopeBoundary) || !PUBLIC_SCOPE_BOUNDARY_RE.test(revision.scopeBoundary.value.trim())) {
    return '';
  }
  return normalizeSearchText(revision.scopeBoundary.value);
}

function capabilityValues(revision: StableConfigRevision): { names: string; summaries: string } {
  const capabilities: readonly CapabilityReference[] = [
    ...revision.instructions,
    ...revision.skills,
    ...revision.mcp,
    ...revision.hooks,
    ...revision.plugins,
  ];
  return {
    names: capabilities.map((capability) => normalizeSearchText(capability.name)).filter(Boolean).join(' '),
    summaries: capabilities
      .map((capability) => (isKnown(capability.summary) ? normalizeSearchText(capability.summary.value) : ''))
      .filter(Boolean)
      .join(' '),
  };
}

function documentForRevision(revision: StableConfigRevision): {
  revisionId: string;
  configName: string;
  scopeBoundary: string;
  capabilityNames: string;
  capabilitySummaries: string;
  triggerCategory: string;
} {
  const capabilities = capabilityValues(revision);
  return {
    revisionId: revision.revisionId,
    configName: normalizeSearchText(revision.configName),
    scopeBoundary: publicScopeBoundary(revision),
    capabilityNames: capabilities.names,
    capabilitySummaries: capabilities.summaries,
    triggerCategory: revision.triggerCategory.normalize('NFKC').toLocaleLowerCase('und'),
  };

}
function matchExpression(query: string): string {
  return normalizeSearchText(query)
    .split(' ')
    .filter(Boolean)
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(' ');
}

export class SqliteConfigSearchAdapter {
  private readonly insertDocument;

  constructor(private readonly db: Database) {
    this.insertDocument = db.query<
      unknown,
      [string, string, string, string, string, string]
    >(
      `INSERT INTO config_search_document (
         revision_id, config_name, scope_boundary, capability_names, capability_summaries, trigger_category
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(revision_id) DO UPDATE SET
         config_name = excluded.config_name,
         scope_boundary = excluded.scope_boundary,
         capability_names = excluded.capability_names,
         capability_summaries = excluded.capability_summaries,
         trigger_category = excluded.trigger_category`,
    );
  }

  indexRevision(revision: StableConfigRevision): void {
    const document = documentForRevision(revision);
    this.insertDocument.run(
      document.revisionId,
      document.configName,
      document.scopeBoundary,
      document.capabilityNames,
      document.capabilitySummaries,
      document.triggerCategory,
    );
  }

  async search(query: string, limit: number): Promise<readonly ConfigSearchResult[]> {
    const expression = matchExpression(query);
    if (expression.length === 0) {
      return [];
    }
    return this.db
      .query<ConfigSearchResult, [string, number]>(
        `SELECT d.revision_id AS revisionId,
                r.config_name AS configName,
                d.trigger_category AS triggerCategory,
                bm25(config_revision_fts) AS rank
           FROM config_revision_fts
           JOIN config_search_document AS d ON d.rowid = config_revision_fts.rowid
           JOIN stable_config_revision AS r ON r.revision_id = d.revision_id
          WHERE config_revision_fts MATCH ?
          ORDER BY rank ASC
          LIMIT ?`,
      )
      .all(expression, limit);
  }

  rebuild(revisions: readonly StableConfigRevision[]): void {
    this.db.transaction(() => {
      this.rebuildWithinTransaction(revisions);
    })();
  }

  rebuildWithinTransaction(revisions: readonly StableConfigRevision[]): void {
    this.db.exec('DELETE FROM config_search_document');
    for (const revision of revisions) {
      this.indexRevision(revision);
    }
  }
}
