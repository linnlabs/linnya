import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginWorkspaceDocumentUpdatedPayload } from '@plugin/backend/workspaceRuntime';
import type { DeckSpec } from '@plugin/slides/shared';
import {
  PresentationSourceConsistencyError,
} from '../features/presentationSourceHistory';
import {
  PresentationStaleBaseError,
} from './definitions/presentationRepository';
import { PresentationRepository } from './repositories/PresentationRepository';
import { PRESENTATION_DOCUMENT_SCHEMAS } from './schemas/presentation.schema';

const SOURCE_V1 = [
  'const slide = createSlide();',
  'const title = createText({ content: "Revision 1" });',
  'slide.add(title);',
  'compose({ title: "Revision 1", slides: [slide] });',
].join('\n');

function makeDeckSpec(title: string): DeckSpec {
  return {
    title,
    layout: '16x9',
    slides: [{
      slideNumber: 1,
      spec: {
        type: 'structured',
        elements: [{
          type: 'title',
          content: title,
          position: { x: 0.5, y: 0.5, w: 9, h: 1 },
        }],
      },
    }],
  };
}

function installWorkspaceSchema(db: Database.Database): void {
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
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (node_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE
    );
  `);
  for (const ddl of PRESENTATION_DOCUMENT_SCHEMAS) {
    db.exec(ddl);
  }
}

function insertWorkspaceNode(db: Database.Database, nodeId: string): void {
  db.prepare(`
    INSERT INTO workspace_nodes (id, project_id, type, name, created_at, updated_at)
    VALUES (?, 'project-1', 'presentation', 'deck.slides', 1, 1)
  `).run(nodeId);
}

async function flushPublish(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('PresentationRepository current materialization and source revisions', () => {
  let db: Database.Database;
  let repo: PresentationRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    installWorkspaceSchema(db);
    repo = new PresentationRepository(db);
  });

  it('原子创建 current document、首个 checkpoint 与源码文本快照', async () => {
    insertWorkspaceNode(db, 'deck-1');
    const result = await repo.createPresentation('deck-1', makeDeckSpec('Revision 1'), {
      pptxBuffer: Buffer.from('pptx-v1'),
      deckSource: SOURCE_V1,
      authorId: 'author-1',
      origin: 'codegen',
    });

    expect(result.revision).toBe(1);
    expect(result.revisionId).toMatch(/^[0-9a-f-]{36}$/);
    const document = await repo.getPresentation('deck-1');
    expect(document).toMatchObject({
      currentRevisionId: result.revisionId,
      currentRevision: 1,
      deckSource: SOURCE_V1,
      title: 'Revision 1',
      slideCount: 1,
      authorId: 'author-1',
    });
    expect(document?.pptxBuffer.equals(Buffer.from('pptx-v1'))).toBe(true);

    const revisions = await repo.listRevisions('deck-1');
    expect(revisions).toEqual([
      expect.objectContaining({
        revisionId: result.revisionId,
        revision: 1,
        parentRevisionId: null,
        storageKind: 'checkpoint',
        patchBytes: 0,
        origin: 'codegen',
      }),
    ]);
    expect(await repo.getRevisionSource('deck-1', 1)).toBe(SOURCE_V1);
    expect(db.prepare(
      'SELECT text FROM workspace_node_text_snapshots WHERE node_id = ?',
    ).pluck().get('deck-1')).toBe(SOURCE_V1);
  });

  it('自定义画布以 DeckSpec 保存完整事实，并在摘要列保存 canonical key', async () => {
    insertWorkspaceNode(db, 'deck-custom');
    const deck = makeDeckSpec('Vertical');
    deck.layout = { width: 5.625, height: 10, unit: 'in' };

    await repo.createPresentation('deck-custom', deck, {
      pptxBuffer: Buffer.from('pptx-custom'),
      deckSource: SOURCE_V1,
      origin: 'create',
    });

    expect((await repo.getPresentation('deck-custom'))?.deckSpec.layout).toEqual({
      width: 5.625,
      height: 10,
      unit: 'in',
    });
    expect(db.prepare(
      'SELECT layout FROM presentation_documents WHERE node_id = ?',
    ).pluck().get('deck-custom')).toBe('custom:5143500x9144000');
  });

  it('提交只覆盖一行 current，并追加可精确重建的轻量源码 revision', async () => {
    insertWorkspaceNode(db, 'deck-2');
    const created = await repo.createPresentation('deck-2', makeDeckSpec('Revision 1'), {
      pptxBuffer: Buffer.from('pptx-v1'),
      deckSource: SOURCE_V1,
      origin: 'create',
    });
    const sourceV2 = SOURCE_V1.replaceAll('Revision 1', 'Revision 2');
    const committed = await repo.commitPresentation('deck-2', makeDeckSpec('Revision 2'), {
      pptxBuffer: Buffer.from('pptx-v2'),
      deckSource: sourceV2,
      baseRevisionId: created.revisionId,
      baseRevision: created.revision,
      origin: 'codegen',
    });

    expect(committed.revision).toBe(2);
    expect(db.prepare('SELECT COUNT(*) FROM presentation_documents').pluck().get()).toBe(1);
    expect(db.prepare('SELECT COUNT(*) FROM presentation_revisions').pluck().get()).toBe(2);
    expect(await repo.getRevisionSource('deck-2', 1)).toBe(SOURCE_V1);
    expect(await repo.getRevisionSource('deck-2', 2)).toBe(sourceV2);
    expect((await repo.listRevisions('deck-2'))[0]).toMatchObject({
      revision: 2,
      parentRevisionId: created.revisionId,
      storageKind: 'patch',
      origin: 'codegen',
    });

    const revisionColumns = db.prepare('PRAGMA table_info(presentation_revisions)').all()
      .map((column) => Reflect.get(column, 'name'));
    expect(revisionColumns).not.toContain('deck_spec_json');
    expect(revisionColumns).not.toContain('pptx_buffer');
  });

  it('拒绝 stale base，且不会追加孤立 revision', async () => {
    insertWorkspaceNode(db, 'deck-3');
    const created = await repo.createPresentation('deck-3', makeDeckSpec('Revision 1'), {
      pptxBuffer: Buffer.from('pptx-v1'),
      deckSource: SOURCE_V1,
      origin: 'create',
    });
    const sourceV2 = SOURCE_V1.replaceAll('Revision 1', 'Revision 2');
    await repo.commitPresentation('deck-3', makeDeckSpec('Revision 2'), {
      pptxBuffer: Buffer.from('pptx-v2'),
      deckSource: sourceV2,
      baseRevisionId: created.revisionId,
      baseRevision: 1,
      origin: 'codegen',
    });

    await expect(repo.commitPresentation('deck-3', makeDeckSpec('Stale'), {
      pptxBuffer: Buffer.from('stale'),
      deckSource: SOURCE_V1.replaceAll('Revision 1', 'Stale'),
      baseRevisionId: created.revisionId,
      baseRevision: 1,
      origin: 'codegen',
    })).rejects.toBeInstanceOf(PresentationStaleBaseError);
    expect(db.prepare('SELECT COUNT(*) FROM presentation_revisions').pluck().get()).toBe(2);
  });

  it('第 25 个 revision 写 checkpoint，前后源码都可重建', async () => {
    insertWorkspaceNode(db, 'deck-25');
    let current = await repo.createPresentation('deck-25', makeDeckSpec('Revision 1'), {
      pptxBuffer: Buffer.from('pptx-1'),
      deckSource: SOURCE_V1,
      origin: 'create',
    });
    let source = SOURCE_V1;
    for (let revision = 2; revision <= 25; revision += 1) {
      source = source.replace(`Revision ${revision - 1}`, `Revision ${revision}`);
      current = await repo.commitPresentation('deck-25', makeDeckSpec(`Revision ${revision}`), {
        pptxBuffer: Buffer.from(`pptx-${revision}`),
        deckSource: source,
        baseRevisionId: current.revisionId,
        baseRevision: current.revision,
        origin: 'codegen',
      });
    }

    expect((await repo.listRevisions('deck-25'))[0]).toMatchObject({
      revision: 25,
      storageKind: 'checkpoint',
    });
    expect(await repo.getRevisionSource('deck-25', 24)).toContain('Revision 24');
    expect(await repo.getRevisionSource('deck-25', 25)).toContain('Revision 25');
  });

  it('hash 损坏时显式报告存储一致性错误', async () => {
    insertWorkspaceNode(db, 'deck-corrupt');
    await repo.createPresentation('deck-corrupt', makeDeckSpec('Revision 1'), {
      pptxBuffer: Buffer.from('pptx-v1'),
      deckSource: SOURCE_V1,
      origin: 'create',
    });
    db.prepare(
      "UPDATE presentation_revisions SET source_hash = 'tampered' WHERE node_id = ? AND revision = 1",
    ).run('deck-corrupt');

    await expect(repo.getRevisionSource('deck-corrupt', 1))
      .rejects.toBeInstanceOf(PresentationSourceConsistencyError);
  });

  it('事务后半段失败时 current 与 revision 一起回滚', async () => {
    insertWorkspaceNode(db, 'deck-rollback');
    const created = await repo.createPresentation('deck-rollback', makeDeckSpec('Revision 1'), {
      pptxBuffer: Buffer.from('pptx-v1'),
      deckSource: SOURCE_V1,
      origin: 'create',
    });
    db.exec(`
      CREATE TRIGGER reject_workspace_touch
      BEFORE UPDATE ON workspace_nodes
      BEGIN
        SELECT RAISE(ABORT, 'workspace touch rejected');
      END
    `);

    await expect(repo.commitPresentation('deck-rollback', makeDeckSpec('Revision 2'), {
      pptxBuffer: Buffer.from('pptx-v2'),
      deckSource: SOURCE_V1.replaceAll('Revision 1', 'Revision 2'),
      baseRevisionId: created.revisionId,
      baseRevision: 1,
      origin: 'codegen',
    })).rejects.toThrow('workspace touch rejected');
    expect((await repo.getPresentation('deck-rollback'))?.currentRevision).toBe(1);
    expect(db.prepare('SELECT COUNT(*) FROM presentation_revisions').pluck().get()).toBe(1);
  });

  it('提交完成后保持既有 document.updated 对外事件合同', async () => {
    const publishDocumentUpdated = vi.fn<(payload: PluginWorkspaceDocumentUpdatedPayload) => void>();
    repo = new PresentationRepository(db, { publishDocumentUpdated });
    insertWorkspaceNode(db, 'deck-event');
    const created = await repo.createPresentation('deck-event', makeDeckSpec('Revision 1'), {
      pptxBuffer: Buffer.from('pptx-v1'),
      deckSource: SOURCE_V1,
      origin: 'create',
    });
    await repo.commitPresentation('deck-event', makeDeckSpec('Revision 2'), {
      pptxBuffer: Buffer.from('pptx-v2'),
      deckSource: SOURCE_V1.replaceAll('Revision 1', 'Revision 2'),
      baseRevisionId: created.revisionId,
      baseRevision: 1,
      origin: 'codegen',
    });
    await flushPublish();

    expect(publishDocumentUpdated).toHaveBeenLastCalledWith({
      projectId: 'project-1',
      documentId: 'deck-event',
      nodeType: 'presentation',
      mutationKind: 'version',
      versionNumber: 2,
    });
  });
});
