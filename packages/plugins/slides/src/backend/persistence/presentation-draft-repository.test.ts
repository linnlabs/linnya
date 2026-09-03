import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DeckSpec } from '@plugin/slides/shared';
import { PresentationDraftStaleBaseError } from './definitions/presentationRepository';
import { PresentationDraftRepository } from './repositories/PresentationDraftRepository';
import { PresentationRepository } from './repositories/PresentationRepository';
import { PRESENTATION_DOCUMENT_SCHEMAS } from './schemas/presentation.schema';

const SOURCE = 'const slide = createSlide();\ncompose({ title: "Deck", slides: [slide] });';
const DECK: DeckSpec = { title: 'Deck', layout: '16x9', slides: [] };

function installSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE workspace_nodes (
      id TEXT PRIMARY KEY,
      project_id TEXT,
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
      metadata_json TEXT,
      source_plugin_id TEXT,
      source_node_type TEXT,
      updated_at INTEGER NOT NULL
    );
  `);
  for (const ddl of PRESENTATION_DOCUMENT_SCHEMAS) db.exec(ddl);
}

describe('PresentationDraftRepository', () => {
  let db: Database.Database;
  let drafts: PresentationDraftRepository;
  let presentations: PresentationRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    installSchema(db);
    drafts = new PresentationDraftRepository(db);
    presentations = new PresentationRepository(db);
    db.prepare(
      `
      INSERT INTO workspace_nodes (id, type, name, created_at, updated_at)
      VALUES ('deck-1', 'presentation', 'Deck', 1, 1)
    `
    ).run();
  });

  it('保存并读取绑定 current revision 的规范化草稿', async () => {
    await presentations.createPresentation('deck-1', DECK, {
      pptxBuffer: Buffer.from('pptx'),
      deckSource: SOURCE,
      origin: 'create',
    });
    const current = await presentations.getPresentation('deck-1');
    if (!current) throw new Error('missing current document');

    const draft = drafts.upsert(
      'deck-1',
      'line 1\r\nline 2',
      current,
      'typecheck failed',
      'slides.codegen.typecheck'
    );
    expect(draft).toMatchObject({
      deckSource: 'line 1\nline 2',
      baseRevisionId: current.currentRevisionId,
      baseRevision: 1,
      lastErrorKind: 'slides.codegen.typecheck',
    });
    expect(drafts.has('deck-1')).toBe(true);
    expect(drafts.get('deck-1')?.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      db.prepare('SELECT text FROM workspace_node_text_snapshots WHERE node_id = ?').get('deck-1')
    ).toEqual({ text: 'line 1\nline 2' });
  });

  it('current revision 前进后拒绝旧 base 写入并隐藏旧草稿', async () => {
    const created = await presentations.createPresentation('deck-1', DECK, {
      pptxBuffer: Buffer.from('pptx-1'),
      deckSource: SOURCE,
      origin: 'create',
    });
    const revision1 = await presentations.getPresentation('deck-1');
    if (!revision1) throw new Error('missing revision 1');
    drafts.upsert('deck-1', 'broken source', revision1, 'failed', 'slides.codegen.sandbox');

    await presentations.commitPresentation('deck-1', DECK, {
      pptxBuffer: Buffer.from('pptx-2'),
      deckSource: SOURCE.replace('"Deck"', '"Deck 2"'),
      baseRevisionId: created.revisionId,
      baseRevision: 1,
      origin: 'codegen',
    });

    expect(drafts.get('deck-1')).toBeNull();
    expect(drafts.has('deck-1')).toBe(false);
    expect(() =>
      drafts.upsert('deck-1', 'older failure', revision1, 'failed', 'slides.codegen.sandbox')
    ).toThrow(PresentationDraftStaleBaseError);
  });

  it('同一 current revision 的重复失败覆盖源码但保留 createdAt', async () => {
    await presentations.createPresentation('deck-1', DECK, {
      pptxBuffer: Buffer.from('pptx'),
      deckSource: SOURCE,
      origin: 'create',
    });
    const current = await presentations.getPresentation('deck-1');
    if (!current) throw new Error('missing current document');
    const first = drafts.upsert('deck-1', 'broken 1', current, 'first', 'slides.codegen.sandbox');
    const second = drafts.upsert(
      'deck-1',
      'broken 2',
      current,
      'second',
      'slides.materialization.pptx_failed'
    );

    expect(second.deckSource).toBe('broken 2');
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.lastErrorKind).toBe('slides.materialization.pptx_failed');
  });

  it('删除 workspace node 时级联删除 current、revision 和 draft', async () => {
    await presentations.createPresentation('deck-1', DECK, {
      pptxBuffer: Buffer.from('pptx'),
      deckSource: SOURCE,
      origin: 'create',
    });
    const current = await presentations.getPresentation('deck-1');
    if (!current) throw new Error('missing current document');
    drafts.upsert('deck-1', 'broken', current, 'failed', 'slides.codegen.sandbox');

    db.prepare('DELETE FROM workspace_nodes WHERE id = ?').run('deck-1');
    expect(db.prepare('SELECT COUNT(*) FROM presentation_documents').pluck().get()).toBe(0);
    expect(db.prepare('SELECT COUNT(*) FROM presentation_revisions').pluck().get()).toBe(0);
    expect(db.prepare('SELECT COUNT(*) FROM presentation_drafts').pluck().get()).toBe(0);
  });

  it('创建补偿回滚会清理 presentation 聚合，但不越权删除 Workspace 节点', async () => {
    await presentations.createPresentation('deck-1', DECK, {
      pptxBuffer: Buffer.from('pptx'),
      deckSource: SOURCE,
      origin: 'create',
    });
    const current = await presentations.getPresentation('deck-1');
    if (!current) throw new Error('missing current document');
    drafts.upsert('deck-1', 'broken', current, 'failed', 'slides.codegen.sandbox');

    await presentations.discardCreatedPresentation('deck-1');

    expect(db.prepare('SELECT COUNT(*) FROM presentation_documents').pluck().get()).toBe(0);
    expect(db.prepare('SELECT COUNT(*) FROM presentation_revisions').pluck().get()).toBe(0);
    expect(db.prepare('SELECT COUNT(*) FROM presentation_drafts').pluck().get()).toBe(0);
    expect(db.prepare('SELECT COUNT(*) FROM workspace_nodes').pluck().get()).toBe(1);
  });
});
