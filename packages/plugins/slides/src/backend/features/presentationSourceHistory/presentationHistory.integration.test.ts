import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeckSpec } from '@plugin/slides/shared';
import { CORE_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/core.schema';
import { WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/node-text-snapshot.schema';
import { PresentationRepository } from '../../persistence/repositories/PresentationRepository';
import { PRESENTATION_DOCUMENT_SCHEMAS } from '../../persistence/schemas/presentation.schema';
import { PRESENTATION_IMAGE_BINDING_SCHEMAS } from '../../persistence/schemas/presentationImageBinding.schema';
import { PRESENTATION_SVG_GRAPHIC_BINDING_SCHEMAS } from '../../persistence/schemas/presentationSvgGraphicBinding.schema';
import { PRESENTATION_HISTORY_SCHEMAS } from './definitions/presentationHistorySchema';
import { PresentationHistoryRepository } from './infrastructure/PresentationHistoryRepository';
import { PresentationRevisionScope } from './orchestration/PresentationRevisionScope';
import { PresentationHistoryRuntime } from './orchestration/PresentationHistoryRuntime';

describe('Slides history retention transactions', () => {
  let db: Database.Database;
  let history: PresentationHistoryRepository;
  let documents: PresentationRepository;
  let scope: PresentationRevisionScope;
  let runtime: PresentationHistoryRuntime;
  const release = vi.fn<(documentId: string, assets: readonly string[]) => void>();
  const deck: DeckSpec = { title: 'History', slides: [], layout: '16x9' };
  const compile = vi.fn(async () => deck);
  const sources = new Map<number, string>();

  beforeEach(async () => {
    release.mockReset(); compile.mockReset().mockResolvedValue(deck); sources.clear();
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    for (const sql of [...CORE_SCHEMAS, ...WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS,
      ...PRESENTATION_DOCUMENT_SCHEMAS, ...PRESENTATION_IMAGE_BINDING_SCHEMAS,
      ...PRESENTATION_SVG_GRAPHIC_BINDING_SCHEMAS, ...PRESENTATION_HISTORY_SCHEMAS]) db.exec(sql);
    db.prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES (?,?,?,?)').run('p', 'Test', 1, 1);
    db.prepare(`INSERT INTO workspace_nodes(id,project_id,type,name,created_at,updated_at)
      VALUES ('doc','p','presentation','History',1,1)`).run();
    scope = new PresentationRevisionScope(); history = new PresentationHistoryRepository(db);
    documents = new PresentationRepository(db, {
      publishDocumentUpdated: () => undefined,
      recordRevisionContext: (doc, id) => history.recordContext(id, scope.readSourceTheme(), scope.read(doc)),
    });
    runtime = new PresentationHistoryRuntime({ history, documents, scope,
      compile,
      render: async (documentId, version) => ({ presentationId: documentId, title: 'History', version: version.order,
        sourceKind: 'generated', slideSize: { width: 13.333333, height: 7.5 }, slides: [],
        capabilities: { hasSemanticRender: true, hasReferencePreview: false, hasHitTest: true, hasSelection: true } }),
      assemble: async () => Buffer.from('pptx'), release, reportFailure: () => undefined,
    });
    for (let i = 1; i <= 20; i++) await append(i);
  });
  afterEach(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    db.close();
  });

  async function append(i: number, assetId = `image-${i}`): Promise<void> {
    await scope.run('doc', async () => {
      scope.record('doc', { assetId, kind: 'image' });
      db.prepare('INSERT OR IGNORE INTO presentation_image_bindings VALUES (?,?,?,?)').run('doc', `source-${assetId}`, assetId, Date.now());
      const source = `// ${'stable source '.repeat(80)}\ncompose({ title: "${i}", slides: [] });`;
      sources.set(i, source);
      const current = await documents.getPresentation('doc');
      const options = { pptxBuffer: Buffer.from(`pptx-${i}`), deckSource: source, origin: 'codegen' as const };
      if (!current) await documents.createPresentation('doc', deck, options);
      else await documents.commitPresentation('doc', deck, { ...options, baseRevisionId: current.currentRevisionId, baseRevision: current.currentRevision });
    });
  }
  const bindings = () => db.prepare<[], { asset_id: string }>('SELECT asset_id FROM presentation_image_bindings ORDER BY asset_id').all().map(row => row.asset_id);

  it('全链校验、稀疏重链、资产解绑后，所有保留版本仍可重放和继续提交', async () => {
    await runtime.compact('doc');
    const retained = history.list('doc');
    expect(retained.length).toBeLessThan(20);
    expect(retained.map(row => row.order)).toEqual(expect.arrayContaining([1, 16, 17, 18, 19, 20]));
    for (const version of retained) expect(await documents.getRevisionSource('doc', version.order)).toBe(sources.get(version.order));
    expect(bindings().sort()).toEqual(retained.map(row => `image-${row.order}`).sort());
    expect(release).toHaveBeenCalledWith('doc', expect.arrayContaining(['image-2']));
    await append(21);
    expect(history.list('doc')[0].order).toBe(21);
    expect(await documents.getRevisionSource('doc', 21)).toBe(sources.get(21));
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('失败草稿的 base 和尚未形成成功引用的图片不被清理', async () => {
    const base = history.list('doc').find(row => row.order === 2);
    if (!base) throw new Error('fixture missing base');
    db.prepare(`INSERT INTO presentation_drafts(node_id,deck_source,source_hash,base_revision_id,base_revision,created_at,updated_at)
      VALUES ('doc','broken source','draft',?,2,1,1)`).run(base.versionId);
    db.prepare('INSERT INTO presentation_image_bindings VALUES (?,?,?,?)').run('doc', 'draft-image', 'draft-only', 1);
    await runtime.compact('doc');
    expect(history.list('doc').some(row => row.order === 2)).toBe(true);
    expect(bindings()).toContain('draft-only');
    expect(release).not.toHaveBeenCalled();
    await append(21);
    await runtime.compact('doc');
    expect(bindings()).not.toContain('draft-only');
  });

  it('释放失败保留重试记录，重新引用后撤销过期计划，不误删 binding', async () => {
    release.mockImplementationOnce(() => { throw new Error('Host unavailable'); });
    await expect(runtime.compact('doc')).rejects.toThrow('Host unavailable');
    expect(db.prepare('SELECT 1 FROM presentation_asset_releases LIMIT 1').get()).toBeDefined();
    await append(21, 'image-2');
    await runtime.compact('doc');
    expect(bindings()).toContain('image-2');
    expect(release.mock.calls[1][1]).not.toContain('image-2');
    expect(db.prepare('SELECT 1 FROM presentation_asset_releases LIMIT 1').get()).toBeUndefined();
  });

  it('中间源码损坏则整次压缩拒绝，历史及资产不变', async () => {
    const before = history.list('doc');
    const assets = bindings();
    db.prepare('UPDATE presentation_revisions SET source_hash = ? WHERE revision = 8').run('corrupt');
    await expect(runtime.compact('doc')).rejects.toThrow();
    expect(history.list('doc')).toEqual(before);
    expect(bindings()).toEqual(assets);
    expect(release).not.toHaveBeenCalled();
    const bad = before.find(row => row.order === 8);
    if (!bad) throw new Error('fixture missing revision');
    await expect(runtime.preview('doc', bad.versionId)).rejects.toMatchObject({ code: 'version_corrupt' });
  });

  it('旧版本上下文回填失败保留全部原历史，不从新主题猜测后清理', async () => {
    db.prepare('DELETE FROM presentation_revision_contexts').run();
    const before = history.list('doc');
    compile.mockRejectedValueOnce(new Error('Missing historical theme'));
    await expect(runtime.compact('doc')).rejects.toThrow('Missing historical theme');
    expect(history.list('doc')).toEqual(before);
    expect(bindings()).toHaveLength(20);
    expect(release).not.toHaveBeenCalled();
  });

  it('恢复编译之后发生另一笔提交，事务校验拒绝覆盖并保留新内容', async () => {
    const versions = history.list('doc');
    const commit = documents.commitPresentation.bind(documents);
    vi.spyOn(documents, 'commitPresentation').mockImplementationOnce(async (id, spec, options) => {
      await commit(id, spec, { ...options, deckSource: 'external edit', origin: 'codegen' });
      return commit(id, spec, options);
    });
    await expect(runtime.restore({ documentId: 'doc', versionId: versions[versions.length - 1].versionId,
      expectedCurrentVersionId: versions[0].versionId })).rejects.toMatchObject({ code: 'version_conflict' });
    expect((await documents.getPresentation('doc'))?.deckSource).toBe('external edit');
    expect(history.list('doc')[0].order).toBe(21);
  });
});
