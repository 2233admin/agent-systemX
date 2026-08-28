import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as queries from '../../src/application/queries';
import { SqliteConfigSearchAdapter, normalizeSearchText } from '../../src/adapters/sqlite/config-search';
import { SqliteConfigRevisionRepository } from '../../src/adapters/sqlite/repository';
import { SqliteConfigRevisionWriter } from '../../src/adapters/sqlite/config-revision-writer';
import { known } from '../../src/domain/facts';
import type { CapabilityReference, StableConfigRevision } from '../../src/domain/config';
import type { ConfigSearchResult } from '../../src/application/ports';

function capability(name: string, summary: string): CapabilityReference {
  return { kind: 'skill', name, sourceCategory: known('project-capability'), summary: known(summary), sourceRef: known('private-source-ref-do-not-index'), contentFingerprint: known('private-fingerprint-do-not-index') };
}
function revision(overrides: Partial<StableConfigRevision> & Pick<StableConfigRevision, 'configName' | 'revisionId'>): StableConfigRevision {
  return { configName: overrides.configName, revisionId: overrides.revisionId, defaultMarker: overrides.defaultMarker ?? known(false), scopeBoundary: overrides.scopeBoundary ?? known('public project scope'), availability: overrides.availability ?? known('resolved'), instructions: overrides.instructions ?? [], skills: overrides.skills ?? [], mcp: overrides.mcp ?? [], hooks: overrides.hooks ?? [], plugins: overrides.plugins ?? [], triggerCategory: overrides.triggerCategory ?? 'new-scenario', evidenceRef: overrides.evidenceRef ?? 'private-evidence-ref-do-not-index', supersedesRevisionId: overrides.supersedesRevisionId ?? null };
}

let tmpDir: string; let dbPath: string; let logs: string[]; let errors: string[]; let originalLog: typeof console.log; let originalError: typeof console.error;
beforeEach(() => { tmpDir = mkdtempSync(path.join(os.tmpdir(), 'control-plane-search-')); dbPath = path.join(tmpDir, 'db.sqlite3'); process.env.CONTROL_PLANE_DB_PATH = dbPath; process.env.CONFIGS_LANG = 'en'; logs = []; errors = []; originalLog = console.log; originalError = console.error; console.log = (...args: unknown[]) => logs.push(args.map(String).join(' ')); console.error = (...args: unknown[]) => errors.push(args.map(String).join(' ')); });
afterEach(() => { console.log = originalLog; console.error = originalError; delete process.env.CONTROL_PLANE_DB_PATH; delete process.env.CONFIGS_LANG; rmSync(tmpDir, { recursive: true, force: true }); });
function seed(revisions: readonly StableConfigRevision[]): void { const repo = new SqliteConfigRevisionRepository(dbPath); try { repo.seed(revisions); } finally { repo.close(); } }
function database(): Database { return new Database(dbPath); }
function jsonOutput(): unknown { return JSON.parse(logs.at(-1) ?? ''); }

async function search(query: string, limit = 20): Promise<readonly ConfigSearchResult[]> {
  const repository = new SqliteConfigRevisionRepository(dbPath);
  try {
    return await (queries as typeof queries & { searchConfigRevisions: Function }).searchConfigRevisions(repository, query, limit);
  } finally {
    repository.close();
  }
}

async function rebuild(): Promise<void> {
  const repository = new SqliteConfigRevisionRepository(dbPath);
  try {
    await (queries as typeof queries & { rebuildConfigSearch: Function }).rebuildConfigSearch(repository);
  } finally {
    repository.close();
  }
}
describe('FTS5 BM25 configuration search contract', () => {
  test('keeps consecutive Latin and numeric characters in complete tokens', () => {
    expect(normalizeSearchText('Permission-Control v2')).toBe('permission control v2');
  });
  test('keeps a supplementary-plane Han singleton as a searchable token', () => {
    const supplementaryHan = String.fromCodePoint(0x20000);
    expect(normalizeSearchText(supplementaryHan)).toBe(supplementaryHan);
  });
  test('creates a strict public projection and external-content FTS table', () => { seed([revision({ configName: 'general', revisionId: 'rev-general' })]); const db = database(); try { const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('config_search_document', 'config_revision_fts') ORDER BY name").all(); expect(tables.map((row) => row.name)).toEqual(['config_revision_fts', 'config_search_document']); expect(db.query<{ name: string }, []>('PRAGMA table_info(config_search_document)').all().map((row) => row.name)).toEqual(['revision_id', 'config_name', 'scope_boundary', 'capability_names', 'capability_summaries', 'trigger_category']); const sql = db.query<{ sql: string | null }, []>("SELECT sql FROM sqlite_master WHERE name = 'config_revision_fts'").get()?.sql ?? ''; expect(sql).toContain("content='config_search_document'"); expect(sql).toContain("tokenize='unicode61'"); } finally { db.close(); } });
  test('does not copy an untrusted private scope boundary into search projection or FTS', () => {
    seed([revision({ configName: 'general', revisionId: 'rev-private-scope', scopeBoundary: known('private secret token / transcript') })]);
    const db = database();
    try {
      const rowid = db.query<{ rowid: number }, [string]>('SELECT rowid FROM config_search_document WHERE revision_id = ?').get('rev-private-scope')?.rowid;
      expect(db.query<{ scope_boundary: string }, [number]>('SELECT scope_boundary FROM config_search_document WHERE rowid = ?').get(rowid!)?.scope_boundary).toBe('');
      expect(db.query<{ scope_boundary: string }, [number]>('SELECT scope_boundary FROM config_revision_fts WHERE rowid = ?').get(rowid!)?.scope_boundary).toBe('');
    } finally {
      db.close();
    }
  });
  test('indexes only exact public scope labels and never arbitrary capability summaries', () => {
    seed([
      revision({ configName: 'public', revisionId: 'rev-public', scopeBoundary: known('public project scope'), skills: [capability('public-skill', 'secret summary must not be indexed')] }),
      revision({ configName: 'prefix-secret', revisionId: 'rev-prefix-secret', scopeBoundary: known('public: secret') }),
      revision({ configName: 'supply-prefix-secret', revisionId: 'rev-supply-prefix-secret', scopeBoundary: known('configs supply: groups secret') }),
    ]);
    const db = database();
    try {
      expect(db.query<{ scope_boundary: string; capability_summaries: string }, [string]>('SELECT scope_boundary, capability_summaries FROM config_search_document WHERE revision_id = ?').get('rev-public')).toEqual({
        scope_boundary: 'public project scope',
        capability_summaries: '',
      });
      expect(db.query<{ scope_boundary: string }, [string]>('SELECT scope_boundary FROM config_search_document WHERE revision_id = ?').get('rev-prefix-secret')?.scope_boundary).toBe('');
      expect(db.query<{ scope_boundary: string }, [string]>('SELECT scope_boundary FROM config_search_document WHERE revision_id = ?').get('rev-supply-prefix-secret')?.scope_boundary).toBe('');
    } finally {
      db.close();
    }
  });
  test('searches English capability names at revision level with numeric BM25 rank', async () => { seed([revision({ configName: 'general', revisionId: 'rev-general', skills: [capability('permission-control', 'Manage permission controls')] }), revision({ configName: 'reviewer', revisionId: 'rev-reviewer', skills: [capability('review-workflow', 'Review changes')] })]); const results = await search('permission'); expect(results[0]).toMatchObject({ revisionId: 'rev-general', configName: 'general', triggerCategory: 'new-scenario' }); expect(typeof (results[0] as { rank: unknown }).rank).toBe('number'); expect(results[0]).not.toHaveProperty('recommendation'); });
  test('searches each trigger category through the public revision-level result', async () => {
    seed([
      revision({ configName: 'scenario', revisionId: 'rev-scenario', triggerCategory: 'new-scenario' }),
      revision({ configName: 'insufficient', revisionId: 'rev-insufficient', triggerCategory: 'known-insufficiency' }),
      revision({ configName: 'bad-case', revisionId: 'rev-bad-case', triggerCategory: 'bad-case' }),
    ]);
    expect((await search('known-insufficiency')).map((row) => row.revisionId)).toEqual(['rev-insufficient']);
    expect((await search('bad-case')).map((row) => row.revisionId)).toEqual(['rev-bad-case']);
  });
  test('indexes capability names across all five capability groups without indexing summaries', async () => {
    const makeCapability = (kind: CapabilityReference['kind'], name: string): CapabilityReference => ({
      kind,
      name,
      sourceCategory: known('project-capability'),
      summary: known(`private summary for ${name}`),
      sourceRef: known(`private-source-${name}`),
      contentFingerprint: known(`private-fingerprint-${name}`),
    });
    seed([
      revision({
        configName: 'all-groups',
        revisionId: 'rev-all-groups',
        instructions: [makeCapability('instruction', 'instruction-token')],
        skills: [makeCapability('skill', 'skill-token')],
        mcp: [makeCapability('mcp', 'mcp-token')],
        hooks: [makeCapability('hook', 'hook-token')],
        plugins: [makeCapability('plugin', 'plugin-token')],
      }),
    ]);
    for (const token of ['instruction-token', 'skill-token', 'mcp-token', 'hook-token', 'plugin-token']) {
      expect((await search(token)).map((row) => row.revisionId)).toEqual(['rev-all-groups']);
    }
    expect(await search('private summary')).toEqual([]);
  });
  test('keeps projection and FTS synchronized when an existing revision is upserted', async () => {
    seed([revision({ configName: 'general', revisionId: 'rev-upsert', skills: [capability('old-token', 'old summary')] })]);
    const db = database();
    try {
      new SqliteConfigSearchAdapter(db).indexRevision(revision({ configName: 'general', revisionId: 'rev-upsert', skills: [capability('new-token', 'new summary')] }));
      expect(await new SqliteConfigSearchAdapter(db).search('new-token', 20)).toEqual([expect.objectContaining({ revisionId: 'rev-upsert' })]);
      expect(await new SqliteConfigSearchAdapter(db).search('old-token', 20)).toEqual([]);
    } finally {
      db.close();
    }
  });
  test('matches Chinese overlapping bigrams without duplicate revision rows', async () => { seed([revision({ configName: '权限配置', revisionId: 'rev-zh', skills: [capability('权限控制', '权限控制与访问管理')] }), revision({ configName: 'other', revisionId: 'rev-other', skills: [capability('审查流程', '代码审查流程')] })]); const results = await search('权限控制'); expect(results.filter((row) => row.revisionId === 'rev-zh')).toHaveLength(1); });
  test('treats punctuation-only input safely and returns no results', async () => { seed([revision({ configName: 'general', revisionId: 'rev-general' })]); expect(await search('!!! ???')).toEqual([]); });
  test('honors explicit and default search limits', async () => { seed(Array.from({ length: 6 }, (_, i) => revision({ configName: `config-${i}`, revisionId: `rev-${i}`, skills: [capability('permission', 'permission management')] }))); expect((await search('permission', 2)).length).toBe(2); expect((await search('permission')).length).toBeLessThanOrEqual(20); });
  test('rebuild restores searchable rows after derived state deletion', async () => {
    seed([revision({ configName: 'general', revisionId: 'rev-general', skills: [capability('permission', 'permission management')] })]);
    const repository = new SqliteConfigRevisionRepository(dbPath);
    try {
      const db = database();
      try {
        db.exec('DELETE FROM config_revision_fts');
        db.exec('DELETE FROM config_search_document');
      } finally {
        db.close();
      }
      expect(await repository.search('permission', 20)).toEqual([]);
      await repository.rebuild();
      expect((await repository.search('permission', 20))[0]).toMatchObject({ revisionId: 'rev-general' });
    } finally {
      repository.close();
    }
  });
  test('backfills existing authoritative revisions when search migration starts', async () => {
    seed([revision({ configName: 'legacy', revisionId: 'rev-legacy', skills: [capability('permission', 'permission management')] })]);
    const db = database();
    try {
      db.exec('DELETE FROM config_revision_fts');
      db.exec('DROP TRIGGER IF EXISTS config_search_document_ai');
      db.exec('DROP TRIGGER IF EXISTS config_search_document_ad');
      db.exec('DROP TRIGGER IF EXISTS config_search_document_au');
      db.exec('DROP TABLE config_revision_fts');
      db.exec('DROP TABLE config_search_document');
    } finally {
      db.close();
    }
    const repository = new SqliteConfigRevisionRepository(dbPath);
    try {
      const results = await repository.search('permission', 20);
      expect(results).toEqual([expect.objectContaining({ revisionId: 'rev-legacy' })]);
    } finally {
      repository.close();
    }
  });

  test('rebuild reads its authoritative snapshot instead of a stale public listAll result', async () => {
    seed([revision({ configName: 'before', revisionId: 'rev-before', skills: [capability('permission', 'permission management')] })]);
    const repository = new SqliteConfigRevisionRepository(dbPath);
    const writer = new SqliteConfigRevisionWriter(dbPath);
    try {
      const staleSnapshot = await repository.listAll();
      await writer.create({
        triggerCategory: 'new-scenario',
        evidenceRef: 'concurrent-evidence',
        candidate: {
          configName: 'during',
          defaultMarker: { kind: 'known', value: false },
          scopeBoundary: { kind: 'known', value: 'public scope' },
          availability: { kind: 'known', value: 'resolved' },
          skills: [{ kind: 'skill', name: 'concurrent-token', sourceCategory: { kind: 'known', value: 'project-capability' }, summary: { kind: 'known', value: 'concurrent summary' } }],
        },
        supersedesRevisionId: null,
      });
      repository.listAll = async () => staleSnapshot;
      await repository.rebuild();
      expect(await repository.search('concurrent-token', 20)).toEqual([expect.objectContaining({ configName: 'during' })]);
    } finally {
      writer.close();
      repository.close();
    }
  });

  test('quotes and FTS operators in a query never throw or broaden the result unexpectedly', async () => {
    seed([revision({ configName: 'general', revisionId: 'rev-general', skills: [capability('permission', 'permission management')] })]);
    for (const query of ['permission OR *', '"permission"', 'permission*', 'permission NEAR/2 management']) {
      const results = await search(query);
      expect(results.every((result) => (result as { revisionId: string }).revisionId === 'rev-general')).toBe(true);
    }
  });

  test('rolls back the authoritative revision when projection indexing fails', async () => {
    seed([]);
    const db = database();
    try {
      db.exec(`CREATE TRIGGER reject_search_index BEFORE INSERT ON config_search_document BEGIN SELECT RAISE(ABORT, 'forced search index failure'); END;`);
    } finally {
      db.close();
    }
    const writer = new SqliteConfigRevisionWriter(dbPath);
    try {
      await expect(writer.create({
        triggerCategory: 'new-scenario',
        evidenceRef: 'rollback-evidence',
        candidate: {
          configName: 'rollback-config',
          defaultMarker: { kind: 'known', value: false },
          scopeBoundary: { kind: 'known', value: 'public scope' },
          availability: { kind: 'known', value: 'resolved' },
          skills: [ { kind: 'skill', name: 'rollback-token', sourceCategory: { kind: 'known', value: 'project-capability' }, summary: { kind: 'known', value: 'rollback summary' } } ],
        },
        supersedesRevisionId: null,
      })).rejects.toThrow('forced search index failure');
    } finally {
      writer.close();
    }
    const after = database();
    try {
      expect(after.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM stable_config_revision').get()?.count).toBe(0);
      expect(after.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM config_search_document').get()?.count).toBe(0);
      expect(after.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM config_revision_fts').get()?.count).toBe(0);
    } finally {
      after.close();
    }
  });
  test('writer-first startup backfills authoritative revisions after search migration creation', async () => {
    seed([revision({ configName: 'legacy-writer', revisionId: 'rev-legacy-writer', skills: [capability('permission', 'permission management')] })]);
    const db = database();
    try {
      db.exec('DROP TRIGGER IF EXISTS config_search_document_ai');
      db.exec('DROP TRIGGER IF EXISTS config_search_document_ad');
      db.exec('DROP TRIGGER IF EXISTS config_search_document_au');
      db.exec('DROP TABLE config_revision_fts');
      db.exec('DROP TABLE config_search_document');
    } finally {
      db.close();
    }
    const writer = new SqliteConfigRevisionWriter(dbPath);
    const rawDb = database();
    try {
      const searchAdapter = new SqliteConfigSearchAdapter(rawDb);
      expect(await searchAdapter.search('permission', 20)).toEqual([expect.objectContaining({ revisionId: 'rev-legacy-writer' })]);
    } finally {
      rawDb.close();
      writer.close();
    }
  });

  test('repairs a partial derived schema and missing projection rows on startup', async () => {
    seed([
      revision({ configName: 'first', revisionId: 'rev-first', skills: [capability('permission', 'permission management')] }),
      revision({ configName: 'second', revisionId: 'rev-second', skills: [capability('permission', 'permission management')] }),
    ]);
    const db = database();
    try {
      db.exec('DROP TRIGGER config_search_document_ai');
      db.exec("DELETE FROM config_search_document WHERE revision_id = 'rev-second'");
      db.exec('DROP TABLE config_revision_fts');
    } finally {
      db.close();
    }
    const repository = new SqliteConfigRevisionRepository(dbPath);
    try {
      expect(await repository.search('permission', 20)).toHaveLength(2);
      const after = database();
      try {
        expect(after.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name IN ('config_search_document_ai', 'config_search_document_ad', 'config_search_document_au')").get()?.count).toBe(3);
      } finally {
        after.close();
      }
    } finally {
      repository.close();
    }
  });

  test('repairs a complete but stale derived index when projection rows lag authority', async () => {
    seed([
      revision({ configName: 'first', revisionId: 'rev-first', skills: [capability('permission', 'permission management')] }),
      revision({ configName: 'second', revisionId: 'rev-second', skills: [capability('permission', 'permission management')] }),
    ]);
    const db = database();
    try {
      db.exec("DELETE FROM config_search_document WHERE revision_id = 'rev-second'");
    } finally {
      db.close();
    }
    const repository = new SqliteConfigRevisionRepository(dbPath);
    try {
      expect(await repository.search('permission', 20)).toHaveLength(2);
    } finally {
      repository.close();
    }
  });

  test('repairs equal-count derived corruption when revision ids differ', async () => {
    seed([
      revision({ configName: 'first', revisionId: 'rev-first', skills: [capability('permission', 'permission management')] }),
      revision({ configName: 'second', revisionId: 'rev-second', skills: [capability('permission', 'permission management')] }),
    ]);
    const db = database();
    try {
      db.exec("DELETE FROM config_search_document WHERE revision_id = 'rev-first'");
      db.query<unknown, [string, string, string, string, string, string]>(
        'INSERT INTO config_search_document (revision_id, config_name, scope_boundary, capability_names, capability_summaries, trigger_category) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('rev-fake', 'fake', 'public', 'permission', 'permission', 'new-scenario');
    } finally {
      db.close();
    }
    const repository = new SqliteConfigRevisionRepository(dbPath);
    try {
      expect((await repository.search('permission', 20)).map((result) => result.revisionId).sort()).toEqual(['rev-first', 'rev-second']);
    } finally {
      repository.close();
    }
  });

  test('repairs an orphan FTS row on startup', async () => {
    seed([revision({ configName: 'general', revisionId: 'rev-orphan', skills: [capability('permission', 'permission summary')] })]);
    const db = database();
    try {
      db.exec("INSERT INTO config_revision_fts(rowid, config_name, scope_boundary, capability_names, capability_summaries, trigger_category) VALUES (999, 'orphan', '', 'orphan-token', '', 'new-scenario')");
    } finally {
      db.close();
    }
    const repository = new SqliteConfigRevisionRepository(dbPath);
    try {
      expect(await repository.search('orphan-token', 20)).toEqual([]);
      expect(await repository.search('permission', 20)).toEqual([expect.objectContaining({ revisionId: 'rev-orphan' })]);
    } finally {
      repository.close();
    }
  });

  test('keeps FTS terms synchronized when a projection row is updated through its trigger', async () => {
    seed([revision({ configName: 'general', revisionId: 'rev-trigger', skills: [capability('old-token', 'old summary')] })]);
    const db = database();
    try {
      db.exec("UPDATE config_search_document SET capability_names = 'new-token' WHERE revision_id = 'rev-trigger'");
    } finally {
      db.close();
    }
    expect(await search('new-token')).toEqual([expect.objectContaining({ revisionId: 'rev-trigger' })]);
    expect(await search('old-token')).toEqual([]);
  });


  test('matches ASCII queries against full-width compatibility forms', async () => {
    seed([revision({ configName: 'compatibility', revisionId: 'rev-compatibility', skills: [capability('Ｐｅｒｍｉｓｓｉｏｎ', 'full-width permission')] })]);
    expect(await search('permission')).toEqual([expect.objectContaining({ revisionId: 'rev-compatibility' })]);
  });
  test('application search results expose only revision-level public fields', async () => { seed([revision({ configName: 'general', revisionId: 'rev-general', skills: [capability('permission', 'permission management')] })]); const result = (await search('permission'))[0]; expect(result).toBeDefined(); expect(Object.keys(result!).sort()).toEqual(['configName', 'rank', 'revisionId', 'triggerCategory']); });
});
