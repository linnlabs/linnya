import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { PluginMigrationDatabase } from '@plugin/backend/pluginMigration';
import { slidesPluginMigrations } from './slidesPluginMigrations';

function toMigrationDatabase(db: Database.Database): PluginMigrationDatabase {
  return {
    exec: sql => db.exec(sql),
    prepare: sql => {
      const statement = db.prepare(sql);
      return {
        get: (...params) => statement.get(...params),
        all: (...params) => statement.all(...params),
        run: (...params) => statement.run(...params),
      };
    },
  };
}

function createWorkspaceTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE workspace_nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE TABLE workspace_node_text_snapshots (
      node_id TEXT PRIMARY KEY,
      content_type TEXT NOT NULL,
      text TEXT NOT NULL,
      source_plugin_id TEXT,
      source_node_type TEXT,
      updated_at INTEGER NOT NULL
    );
  `);
}

function applyMigration(db: Database.Database, version: number): void {
  const migration = slidesPluginMigrations.find(item => item.version === version);
  if (!migration) {
    throw new Error(`migration ${version} not found`);
  }
  db.transaction(() => migration.up(toMigrationDatabase(db)))();
}

function tableNames(db: Database.Database): string[] {
  return (
    db
      .prepare(
        `
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND (name LIKE 'presentation_%' OR name LIKE 'slides_legacy_%')
    ORDER BY name
  `
      )
      .all() as Array<{ name: string }>
  ).map(row => row.name);
}

describe('slidesPluginMigrations', () => {
  it('空库按 v1 -> v2 -> v3 -> v4 -> v5 完整升级到当前结构', () => {
    const db = new Database(':memory:');
    createWorkspaceTables(db);

    applyMigration(db, 1);
    applyMigration(db, 2);
    applyMigration(db, 3);
    applyMigration(db, 4);
    applyMigration(db, 5);

    expect(tableNames(db)).toEqual([
      'presentation_documents',
      'presentation_drafts',
      'presentation_image_bindings',
      'presentation_revisions',
      'presentation_svg_graphic_bindings',
      'presentation_templates',
    ]);
    db.close();
  });

  it('把已执行 v1/v2 的旧表和文稿数据迁移到 current/revision 结构', () => {
    const db = new Database(':memory:');
    createWorkspaceTables(db);
    applyMigration(db, 1);

    const now = 100;
    db.prepare(
      `
      INSERT INTO workspace_nodes (id, type, name, created_at, updated_at)
      VALUES (?, 'presentation', ?, ?, ?)
    `
    ).run('node-1', '旧文稿.slides', now, now);
    db.prepare(
      `
      INSERT INTO presentation_versions (
        id, node_id, version_number, deck_spec_json, pptx_buffer, deck_source,
        title, slide_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      'version-1',
      'node-1',
      1,
      JSON.stringify({ title: '旧文稿', layout: '16x9', slides: [] }),
      Buffer.from('pptx'),
      'const first = true;',
      '旧文稿',
      0,
      now
    );
    db.prepare(
      `
      INSERT INTO presentation_versions (
        id, node_id, version_number, deck_spec_json, pptx_buffer, deck_source,
        title, slide_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      'version-2',
      'node-1',
      2,
      JSON.stringify({ title: '旧文稿', layout: '16x9', slides: [] }),
      Buffer.from('pptx-2'),
      'const second = true;',
      '旧文稿',
      0,
      now + 1
    );
    db.prepare(
      `
      INSERT INTO presentation_drafts (
        node_id, deck_source, source_hash, base_version_id, base_version_number,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    ).run('node-1', 'draft source', 'hash', 'version-2', 2, now, now + 2);

    applyMigration(db, 2);
    applyMigration(db, 3);
    applyMigration(db, 4);
    applyMigration(db, 5);

    const document = db
      .prepare(
        `
      SELECT current_revision_id, current_revision, deck_source, pptx_buffer
      FROM presentation_documents WHERE node_id = ?
    `
      )
      .get('node-1') as {
      current_revision_id: string;
      current_revision: number;
      deck_source: string;
      pptx_buffer: Buffer;
    };
    expect(document).toMatchObject({
      current_revision_id: 'version-2',
      current_revision: 2,
      deck_source: 'const second = true;',
    });
    expect(document.pptx_buffer.equals(Buffer.from('pptx-2'))).toBe(true);
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM presentation_revisions WHERE node_id = ?')
        .get('node-1')
    ).toEqual({ count: 2 });
    expect(
      db
        .prepare(
          'SELECT base_revision_id, base_revision FROM presentation_drafts WHERE node_id = ?'
        )
        .get('node-1')
    ).toEqual({ base_revision_id: 'version-2', base_revision: 2 });
    expect(tableNames(db)).not.toContain('presentation_versions');
    expect(tableNames(db)).not.toContain('slides_legacy_presentation_versions');
    db.close();
  });

  it('保留已发布的迁移版本，不允许回退或重编号', () => {
    expect(slidesPluginMigrations.map(migration => migration.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(slidesPluginMigrations[0]?.description).toBe(
      'Create and adopt Slides presentation tables'
    );
    expect(slidesPluginMigrations[1]?.description).toBe(
      'Backfill workspace text snapshots from latest Slides versions'
    );
  });

  it('v8 建立与 revision 绑定的人工编辑 command receipt', () => {
    const db = new Database(':memory:');
    try {
      createWorkspaceTables(db);
      for (const version of [1, 2, 3, 4, 5, 6, 7, 8]) applyMigration(db, version);
      expect(tableNames(db)).toContain('presentation_manual_edit_receipts');
      const foreignKeys = db.prepare(
        'PRAGMA foreign_key_list(presentation_manual_edit_receipts)',
      ).all().map(row => Reflect.get(row, 'table'));
      expect(foreignKeys).toEqual(expect.arrayContaining([
        'presentation_documents',
        'presentation_revisions',
      ]));
    } finally {
      db.close();
    }
  });

  it('v9 为既有 PPTX 标记其精确 revision，且可安全重入', () => {
    const db = new Database(':memory:');
    try {
      createWorkspaceTables(db);
      for (const version of [1, 2, 3, 4, 5, 6, 7, 8]) applyMigration(db, version);
      db.transaction(() => {
        db.exec(`INSERT INTO workspace_nodes(id,type,name,created_at,updated_at)
          VALUES ('doc','presentation','Test',1000,1000)`);
        db.exec(`INSERT INTO presentation_documents(node_id,current_revision_id,current_revision,
          deck_source,source_hash,deck_spec_json,pptx_buffer,title,slide_count,created_at,updated_at)
          VALUES ('doc','revision-1',1,'source','hash','{}',X'CAFE','Test',0,1000,1000)`);
        db.exec(`INSERT INTO presentation_revisions(
          id,node_id,revision,source_hash,storage_kind,source_checkpoint,patch_bytes,created_at,origin
        ) VALUES ('revision-1','doc',1,'hash','checkpoint','source',0,1000,'create')`);
        db.exec(`INSERT INTO presentation_image_bindings(
          presentation_id,source_identity,asset_id,created_at
        ) VALUES ('doc','image-source','image-asset',1000)`);
        db.exec(`INSERT INTO presentation_svg_graphic_bindings(
          presentation_id,source_identity,asset_id,content_hash,byte_length,
          viewbox_width,viewbox_height,created_at
        ) VALUES ('doc','svg-source','svg-asset','svg-hash',10,100,100,1000)`);
      })();
      applyMigration(db, 9);
      applyMigration(db, 9);
      expect(db.prepare('SELECT pptx_revision_id FROM presentation_documents').pluck().get())
        .toBe('revision-1');
      expect(db.prepare(`
        SELECT asset_id, asset_kind FROM presentation_revision_assets ORDER BY asset_kind
      `).all()).toEqual([
        { asset_id: 'image-asset', asset_kind: 'image' },
        { asset_id: 'svg-asset', asset_kind: 'svg' },
      ]);
    } finally {
      db.close();
    }
  });

  it('旧库补恢复来源列，重入不重复加列或猜测来源', () => {
    const db = new Database(':memory:');
    try {
      createWorkspaceTables(db);
      for (const version of [1, 2, 3, 4, 5, 6]) applyMigration(db, version);
      db.exec('ALTER TABLE presentation_revisions DROP COLUMN restored_from_version_id');
      db.exec('ALTER TABLE presentation_revisions DROP COLUMN restored_from_created_at');
      db.transaction(() => {
        db.exec(`INSERT INTO workspace_nodes(id,type,name,created_at,updated_at)
          VALUES ('doc','presentation','Test',1000,1000)`);
        db.exec(`INSERT INTO presentation_documents(node_id,current_revision_id,current_revision,
          deck_source,source_hash,deck_spec_json,pptx_buffer,title,slide_count,created_at,updated_at)
          VALUES ('doc','restored',1,'source','hash','{}',X'00','Test',0,1000,1000)`);
        db.exec(`INSERT INTO presentation_revisions (
          id,node_id,revision,source_hash,storage_kind,source_checkpoint,patch_bytes,created_at,origin
        ) VALUES ('restored','doc',1,'hash','checkpoint','source',0,1000,'restore')`);
      })();
      applyMigration(db, 7);
      applyMigration(db, 7);
      expect(db.prepare('SELECT restored_from_version_id, restored_from_created_at FROM presentation_revisions').get())
        .toEqual({ restored_from_version_id: null, restored_from_created_at: null });
    } finally { db.close(); }
  });
});
