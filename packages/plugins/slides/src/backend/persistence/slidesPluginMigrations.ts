import { createHash } from 'node:crypto';
import type {
  PluginMigrationDatabase,
  PluginMigrationDefinition,
} from '@plugin/backend/pluginMigration';
import { SLIDES_PLUGIN_ID } from '@plugin/slides/shared';
import { PRESENTATION_DOCUMENT_SCHEMAS } from './schemas/presentation.schema.js';
import { PRESENTATION_IMAGE_BINDING_SCHEMAS } from './schemas/presentationImageBinding.schema.js';
import { PRESENTATION_SVG_GRAPHIC_BINDING_SCHEMAS } from './schemas/presentationSvgGraphicBinding.schema.js';

const PRESENTATION_NODE_TYPE = 'presentation';

/**
 * v1/v2 已经发布并写入过用户数据库，不能因为当前结构重构而改写。
 * v3 会把这组历史表转换为 current document/revision 结构。
 */
const LEGACY_PRESENTATION_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS presentation_versions (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    deck_spec_json TEXT NOT NULL,
    pptx_buffer BLOB,
    source_pptx_buffer BLOB,
    source_kind TEXT NOT NULL DEFAULT 'generated',
    deck_source TEXT,
    title TEXT NOT NULL,
    slide_count INTEGER NOT NULL,
    layout TEXT,
    created_at INTEGER NOT NULL,
    author_id TEXT,
    FOREIGN KEY (node_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_presentation_versions_node_id
    ON presentation_versions(node_id)`,
  `CREATE INDEX IF NOT EXISTS idx_presentation_versions_node_version
    ON presentation_versions(node_id, version_number DESC)`,
  `CREATE TABLE IF NOT EXISTS presentation_drafts (
    node_id TEXT PRIMARY KEY,
    deck_source TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    base_version_id TEXT NOT NULL,
    base_version_number INTEGER NOT NULL,
    last_error_summary TEXT,
    last_error_kind TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (node_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS presentation_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    template_spec_json TEXT NOT NULL,
    source_pptx_buffer BLOB,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    usage_count INTEGER DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_presentation_templates_name
    ON presentation_templates(name)`,
] as const;

interface SqliteNameRow {
  readonly name: string;
}

interface LegacyVersionRow {
  readonly id: string;
  readonly node_id: string;
  readonly version_number: number;
  readonly deck_spec_json: string;
  readonly pptx_buffer: Buffer | null;
  readonly deck_source: string | null;
  readonly title: string;
  readonly slide_count: number;
  readonly layout: string | null;
  readonly created_at: number;
  readonly author_id: string | null;
}

interface LegacyDraftRow {
  readonly node_id: string;
  readonly deck_source: string;
  readonly source_hash: string;
  readonly base_version_id: string;
  readonly base_version_number: number;
  readonly last_error_summary: string | null;
  readonly last_error_kind: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

interface LegacyTemplateRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly template_spec_json: string;
  readonly source_pptx_buffer: Buffer | null;
  readonly created_at: number;
  readonly updated_at: number;
  readonly usage_count: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

function isBufferOrNull(value: unknown): value is Buffer | null {
  return Buffer.isBuffer(value) || value === null;
}

function isSqliteNameRow(value: unknown): value is SqliteNameRow {
  return isRecord(value) && typeof value.name === 'string';
}

function isLegacyVersionRow(value: unknown): value is LegacyVersionRow {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.node_id === 'string' &&
    isFiniteInteger(value.version_number) &&
    typeof value.deck_spec_json === 'string' &&
    isBufferOrNull(value.pptx_buffer) &&
    isNullableString(value.deck_source) &&
    typeof value.title === 'string' &&
    isFiniteInteger(value.slide_count) &&
    isNullableString(value.layout) &&
    isFiniteInteger(value.created_at) &&
    isNullableString(value.author_id)
  );
}

function isLegacyDraftRow(value: unknown): value is LegacyDraftRow {
  return (
    isRecord(value) &&
    typeof value.node_id === 'string' &&
    typeof value.deck_source === 'string' &&
    typeof value.source_hash === 'string' &&
    typeof value.base_version_id === 'string' &&
    isFiniteInteger(value.base_version_number) &&
    isNullableString(value.last_error_summary) &&
    isNullableString(value.last_error_kind) &&
    isFiniteInteger(value.created_at) &&
    isFiniteInteger(value.updated_at)
  );
}

function isLegacyTemplateRow(value: unknown): value is LegacyTemplateRow {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isNullableString(value.description) &&
    typeof value.template_spec_json === 'string' &&
    isBufferOrNull(value.source_pptx_buffer) &&
    isFiniteInteger(value.created_at) &&
    isFiniteInteger(value.updated_at) &&
    (value.usage_count === null || isFiniteInteger(value.usage_count))
  );
}

function tableExists(db: PluginMigrationDatabase, tableName: string): boolean {
  const get = db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get;
  if (!get) {
    throw new Error('Slides schema migration 缺少 SQLite 读取能力。');
  }
  return isSqliteNameRow(get(tableName));
}

function readAll(db: PluginMigrationDatabase, sql: string, ...params: unknown[]): unknown[] {
  const all = db.prepare(sql).all;
  if (!all) {
    throw new Error('Slides schema migration 缺少 SQLite 查询能力。');
  }
  return all(...params);
}

function hashSource(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

function normalizeSource(row: LegacyVersionRow): string {
  const source = row.deck_source?.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (source?.trim()) {
    return source;
  }
  try {
    return JSON.stringify(JSON.parse(row.deck_spec_json), null, 2);
  } catch {
    throw new Error(`Slides v3 无法为旧文稿 ${row.node_id} 生成有效源码。`);
  }
}

function renameLegacyTables(db: PluginMigrationDatabase): void {
  const renames = [
    ['presentation_versions', 'slides_legacy_presentation_versions'],
    ['presentation_drafts', 'slides_legacy_presentation_drafts'],
    ['presentation_templates', 'slides_legacy_presentation_templates'],
  ] as const;
  for (const [from, to] of renames) {
    if (tableExists(db, from)) {
      db.exec(`ALTER TABLE ${from} RENAME TO ${to}`);
    }
  }
}

function migrateLegacyDocuments(db: PluginMigrationDatabase): Map<string, string> {
  const rows = readAll(
    db,
    `
    SELECT id, node_id, version_number, deck_spec_json, pptx_buffer, deck_source,
           title, slide_count, layout, created_at, author_id
    FROM slides_legacy_presentation_versions
    ORDER BY node_id, version_number ASC
  `
  ).map(row => {
    if (!isLegacyVersionRow(row)) {
      throw new Error('Slides v3 读取到异常的旧 presentation_versions 行。');
    }
    return row;
  });
  const revisionIds = new Map<string, string>();
  const grouped = new Map<string, LegacyVersionRow[]>();
  for (const row of rows) {
    const versions = grouped.get(row.node_id) ?? [];
    versions.push(row);
    grouped.set(row.node_id, versions);
  }

  const insertRevision = db.prepare(`
    INSERT INTO presentation_revisions (
      id, node_id, revision, parent_revision_id, base_source_hash, source_hash,
      storage_kind, source_checkpoint, source_patch, patch_bytes,
      created_at, author_id, origin
    ) VALUES (?, ?, ?, ?, ?, ?, 'checkpoint', ?, NULL, 0, ?, ?, ?)
  `).run;
  const insertDocument = db.prepare(`
    INSERT INTO presentation_documents (
      node_id, current_revision_id, current_revision, deck_source, source_hash,
      deck_spec_json, pptx_buffer, title, slide_count, layout, created_at, updated_at, author_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run;
  if (!insertRevision || !insertDocument) {
    throw new Error('Slides v3 缺少数据库写入能力。');
  }

  for (const [nodeId, versions] of grouped) {
    const latest = versions[versions.length - 1];
    if (!latest) {
      continue;
    }
    const latestSource = normalizeSource(latest);
    const latestRevisionId = latest.id;
    insertDocument(
      nodeId,
      latestRevisionId,
      versions.length,
      latestSource,
      hashSource(latestSource),
      latest.deck_spec_json,
      latest.pptx_buffer ?? Buffer.alloc(0),
      latest.title,
      latest.slide_count,
      latest.layout,
      versions[0]?.created_at ?? latest.created_at,
      latest.created_at,
      latest.author_id
    );

    let previousSourceHash: string | null = null;
    let previousRevisionId: string | null = null;
    versions.forEach((row, index) => {
      const source = normalizeSource(row);
      const sourceHash = hashSource(source);
      const revision = index + 1;
      const revisionId = row.id;
      insertRevision(
        revisionId,
        nodeId,
        revision,
        previousRevisionId,
        previousSourceHash,
        sourceHash,
        source,
        row.created_at,
        row.author_id,
        revision === 1 ? 'create' : 'restore'
      );
      revisionIds.set(row.id, revisionId);
      previousSourceHash = sourceHash;
      previousRevisionId = revisionId;
    });
  }
  return revisionIds;
}

function migrateLegacyDrafts(
  db: PluginMigrationDatabase,
  revisionIds: ReadonlyMap<string, string>
): void {
  const rows = readAll(
    db,
    `
    SELECT node_id, deck_source, source_hash, base_version_id, base_version_number,
           last_error_summary, last_error_kind, created_at, updated_at
    FROM slides_legacy_presentation_drafts
  `
  ).map(row => {
    if (!isLegacyDraftRow(row)) {
      throw new Error('Slides v3 读取到异常的旧 presentation_drafts 行。');
    }
    return row;
  });
  const run = db.prepare(`
    INSERT INTO presentation_drafts (
      node_id, deck_source, source_hash, base_revision_id, base_revision,
      last_error_summary, last_error_kind, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run;
  if (!run) {
    throw new Error('Slides v3 缺少 draft 写入能力。');
  }
  for (const row of rows) {
    const baseRevisionId = revisionIds.get(row.base_version_id);
    if (!baseRevisionId) {
      continue;
    }
    run(
      row.node_id,
      row.deck_source,
      row.source_hash,
      baseRevisionId,
      row.base_version_number,
      row.last_error_summary,
      row.last_error_kind,
      row.created_at,
      row.updated_at
    );
  }
}

function migrateLegacyTemplates(db: PluginMigrationDatabase): void {
  const rows = readAll(
    db,
    `
    SELECT id, name, description, template_spec_json, source_pptx_buffer,
           created_at, updated_at, usage_count
    FROM slides_legacy_presentation_templates
  `
  ).map(row => {
    if (!isLegacyTemplateRow(row)) {
      throw new Error('Slides v3 读取到异常的旧 presentation_templates 行。');
    }
    return row;
  });
  const run = db.prepare(`
    INSERT INTO presentation_templates (
      id, name, description, template_spec_json, source_pptx_buffer,
      created_at, updated_at, usage_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run;
  if (!run) {
    throw new Error('Slides v3 缺少 template 写入能力。');
  }
  for (const row of rows) {
    run(
      row.id,
      row.name,
      row.description,
      row.template_spec_json,
      row.source_pptx_buffer ?? Buffer.alloc(0),
      row.created_at,
      row.updated_at,
      row.usage_count ?? 0
    );
  }
}

function migrateCurrentPresentationSchema(db: PluginMigrationDatabase): void {
  renameLegacyTables(db);
  for (const statement of PRESENTATION_DOCUMENT_SCHEMAS) {
    db.exec(statement);
  }
  if (!tableExists(db, 'slides_legacy_presentation_versions')) {
    return;
  }
  const revisionIds = migrateLegacyDocuments(db);
  migrateLegacyDrafts(db, revisionIds);
  migrateLegacyTemplates(db);
  db.exec(`
    DROP TABLE IF EXISTS slides_legacy_presentation_versions;
    DROP TABLE IF EXISTS slides_legacy_presentation_drafts;
    DROP TABLE IF EXISTS slides_legacy_presentation_templates;
  `);
}

function backfillWorkspaceSnapshots(db: PluginMigrationDatabase): void {
  if (
    !tableExists(db, 'workspace_node_text_snapshots') ||
    !tableExists(db, 'presentation_versions')
  ) {
    return;
  }
  const rows = readAll(
    db,
    `
    SELECT v.node_id, v.deck_source, v.deck_spec_json, v.created_at AS updated_at
    FROM presentation_versions v
    INNER JOIN (
      SELECT node_id, MAX(version_number) AS version_number
      FROM presentation_versions GROUP BY node_id
    ) latest ON latest.node_id = v.node_id AND latest.version_number = v.version_number
    WHERE NOT EXISTS (
      SELECT 1 FROM workspace_node_text_snapshots s WHERE s.node_id = v.node_id
    )
  `
  );
  const run = db.prepare(`
    INSERT INTO workspace_node_text_snapshots
      (node_id, content_type, text, source_plugin_id, source_node_type, updated_at)
    VALUES (?, 'text/plain', ?, ?, ?, ?)
    ON CONFLICT(node_id) DO NOTHING
  `).run;
  if (!run) {
    throw new Error('Slides v2 缺少快照写入能力。');
  }
  for (const row of rows) {
    if (
      !isRecord(row) ||
      typeof row.node_id !== 'string' ||
      !isNullableString(row.deck_source) ||
      typeof row.deck_spec_json !== 'string' ||
      !isFiniteInteger(row.updated_at)
    ) {
      throw new Error('Slides v2 快照回填读取到异常行结构。');
    }
    let text = row.deck_source;
    if (!text?.trim()) {
      try {
        text = JSON.stringify(JSON.parse(row.deck_spec_json), null, 2);
      } catch {
        text = row.deck_spec_json;
      }
    }
    run(row.node_id, text, SLIDES_PLUGIN_ID, PRESENTATION_NODE_TYPE, row.updated_at);
  }
}

export const slidesPluginMigrations: readonly PluginMigrationDefinition[] = [
  {
    version: 1,
    description: 'Create and adopt Slides presentation tables',
    up: db => {
      for (const statement of LEGACY_PRESENTATION_SCHEMAS) {
        db.exec(statement);
      }
    },
  },
  {
    version: 2,
    description: 'Backfill workspace text snapshots from latest Slides versions',
    up: backfillWorkspaceSnapshots,
  },
  {
    version: 3,
    description: 'Materialize current documents and source revision history',
    up: migrateCurrentPresentationSchema,
  },
  {
    version: 4,
    description: 'Bind presentation image sources to owned assets',
    up: db => {
      for (const statement of PRESENTATION_IMAGE_BINDING_SCHEMAS) {
        db.exec(statement);
      }
    },
  },
  {
    version: 5,
    description: 'Bind presentation SVG Graphic sources to owned assets',
    up: db => {
      for (const statement of PRESENTATION_SVG_GRAPHIC_BINDING_SCHEMAS) {
        db.exec(statement);
      }
    },
  },
] as const;
