// @vitest-environment jsdom
import Database from 'better-sqlite3';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { CORE_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/core.schema';
import { ASSET_LEDGER_SCHEMAS } from 'src/domains/assets/features/asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema';
import { MARKDOWN_DOCUMENT_SCHEMAS } from '../../../document-storage/infrastructure/sqlite/schemas/document.schema';
import { PENDING_REVISION_SCHEMAS } from '../../../document-storage/infrastructure/sqlite/schemas/blocks/pending-revision.schema';
import { BLOCK_HISTORY_SCHEMAS } from '../../../document-storage/infrastructure/sqlite/schemas/blocks/block-history.schema';
import { IMAGE_BLOCK_SCHEMAS } from '../../../document-storage/infrastructure/sqlite/schemas/blocks/image.schema';
import { MarkdownDocumentService } from '../../../document-storage';
import { workspaceMarkdownSchemaLite as schema, validateMarkdownDocJson } from '../../../normalization/schemaLite';
import { writeMarkdownDocumentFromText } from '../../../document-write';
import { PendingRevisionApplyService } from '../pendingRevisionApplyService';
import { UniqueIdsExtension, ensureUniqueIdsPluginKey } from '../../../../../../../apps/renderer/domains/editor/extensions/core/UniqueIdsExtension';
import { CitationFeatureExtension, citationAutoMaintainPluginKey } from '../../../../../../../apps/renderer/domains/editor/features/citation/extension/CitationFeatureExtension';
import { markDocumentLoadProjectionTransaction, markPendingRevisionProjectionTransaction } from '../../../../../../../apps/renderer/domains/editor/core/transactions/editorTransactionMeta';
import { readRevisionBaseline } from '../../../../../../../apps/renderer/domains/editor/features/Revision/functions/revisionProjectionBaseline';
import { rebaseEditorDocument } from '../../../../../../../apps/renderer/domains/editor/functions/rebaseEditorDocument';

const databases: Database.Database[] = [];
const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy());
  databases.splice(0).forEach(db => db.close());
});

function setup() {
  const db = new Database(':memory:');
  databases.push(db);
  db.pragma('foreign_keys = ON');
  for (const sql of [
    ...CORE_SCHEMAS, ...ASSET_LEDGER_SCHEMAS, ...MARKDOWN_DOCUMENT_SCHEMAS,
    ...IMAGE_BLOCK_SCHEMAS, ...PENDING_REVISION_SCHEMAS, ...BLOCK_HISTORY_SCHEMAS,
  ]) db.exec(sql);
  db.prepare("INSERT INTO workspace_nodes (id, project_id, parent_id, type, name, created_at, updated_at) VALUES ('doc', NULL, NULL, 'document', 'test', 1, 1)").run();
  const store = new MarkdownDocumentService(db);
  store.createDocument('doc', validateMarkdownDocJson({
    type: 'doc', content: [{
      type: 'rootBlock', attrs: { id: 'root-11111111' }, content: [{
        type: 'baseBlock', attrs: { id: 'block-11111111' }, content: [
          { type: 'text', text: '已有正文 ' },
          { type: 'citationNode', attrs: {
            citationId: 'citation-11111111', ref: 'Abc234', sourceType: 'web',
            sourceId: 'https://example.com/report', url: 'https://example.com/report',
            title: 'Original source', snippet: 'Original excerpt',
          } },
        ],
      }],
    }],
  }));
  // 通过正式扩展管理器取得实际插件；状态使用后台与 Editor 共有的持久化 schema。
  const editor = new Editor({ element: null, extensions: [StarterKit, UniqueIdsExtension, CitationFeatureExtension] });
  editors.push(editor);
  const plugins = editor.extensionManager.plugins.filter(plugin =>
    plugin.spec.key === ensureUniqueIdsPluginKey || plugin.spec.key === citationAutoMaintainPluginKey);
  expect(plugins).toHaveLength(2);
  const load = () => {
    const raw = schema.nodeFromJSON(store.getDocument('doc'));
    const state = EditorState.create({ doc: raw, plugins });
    return { raw, state: state.applyTransaction(markDocumentLoadProjectionTransaction(state.tr)).state };
  };
  return { store, load, apply: new PendingRevisionApplyService(store) };
}

async function createPendingInsert(store: MarkdownDocumentService) {
  const result = await writeMarkdownDocumentFromText({
    documentStore: store, documentId: 'doc', toolName: 'write_file',
    targetText: '已有正文 [@Abc234]\n\n新增段落',
    annotationAdmission: { author: 'AI', meta: { source: 'agent' } },
    touchDocumentUpdatedAt: () => undefined,
  });
  expect(result.edits).toHaveLength(1);
  expect(result.edits[0]?.operation).toBe('insert');
  const revision = store.getPendingRevisions('doc')[0];
  const version = store.getLatestVersion('doc');
  if (!revision || !version) throw new Error('Missing pending insert fixture');
  return { revision, version };
}

describe('pending insert → cold editor load → projection baseline → accept', () => {
  it('无需先保存即可接受含引用文档的新段落，冷加载不改写占位块身份', async () => {
    const { store, load, apply } = setup();
    const { revision, version } = await createPendingInsert(store);
    const { raw, state } = load();
    expect(state.doc.lastChild?.firstChild?.type.name).toBe('bibliographyBlock');
    const baselineRoot = state.doc.child(1);
    const position = state.doc.child(0).nodeSize + 2;
    const tr = state.tr.insertText('新增段落', position);
    tr.addMark(position, position + 4, schema.marks.revisionMark.create({ revisionId: revision.id, changeType: 'insert' }));
    const projected = state.applyTransaction(markPendingRevisionProjectionTransaction(tr)).state;
    const local = readRevisionBaseline(projected.doc, new Map([
      [revision.target_block_id, { baseline: baselineRoot, projected: projected.doc.child(1) }],
    ]), new Map());
    expect(local.eq(state.doc)).toBe(true);
    const baseline = rebaseEditorDocument(raw, local, raw);
    const accepted = await apply.commitEditorRevision({
      documentId: 'doc', expectedVersionNumber: version.version_number,
      expectedPending: [{ id: revision.id, revision: revision.revision }],
      baseline: baseline.toJSON(), decision: { mode: 'accept' },
    });
    expect(baselineRoot.firstChild?.attrs.id).toBe(raw.child(1).firstChild?.attrs.id);
    expect(accepted.content.content[1]?.content?.[0]?.content?.[0]?.text).toBe('新增段落');
    expect(schema.nodeFromJSON(accepted.content).child(0).eq(raw.child(0))).toBe(true);
    expect(store.getPendingRevisions('doc')).toEqual([]);
    const reopened = load();
    expect(reopened.state.doc.eq(reopened.raw)).toBe(true);
  });

  it('占位块中确有本地输入时仍拒绝 Accept，保留正文版本与 pending', async () => {
    const { store, load, apply } = setup();
    const { revision, version } = await createPendingInsert(store);
    const { raw, state } = load();
    const local = state.applyTransaction(state.tr.insertText('用户输入', state.doc.child(0).nodeSize + 2)).state.doc;
    await expect(apply.commitEditorRevision({
      documentId: 'doc', expectedVersionNumber: version.version_number,
      expectedPending: [{ id: revision.id, revision: revision.revision }],
      baseline: rebaseEditorDocument(raw, local, raw).toJSON(), decision: { mode: 'accept' },
    })).rejects.toThrow('本地编辑与待接受的修订在同一块重叠');
    expect(store.getLatestVersion('doc')?.version_number).toBe(version.version_number);
    expect(schema.nodeFromJSON(store.getDocument('doc')).eq(raw)).toBe(true);
    expect(store.getPendingRevisions('doc')).toEqual([revision]);
  });

  it('既有非法占位 ID 不绕过冲突校验，经正式保存同步后可接受修订', async () => {
    const { store, load, apply } = setup();
    const { revision } = await createPendingInsert(store);
    const legacy = store.getDocument('doc');
    const inner = legacy.content[1]?.content?.[0];
    if (!inner) throw new Error('Missing legacy placeholder fixture');
    inner.attrs = { ...inner.attrs, id: `${revision.target_block_id}-inner` };
    store.updateDocument('doc', legacy);
    const version = store.getLatestVersion('doc');
    if (!version) throw new Error('Missing legacy version');
    const { raw, state } = load();
    const request = {
      documentId: 'doc', expectedVersionNumber: version.version_number,
      expectedPending: [{ id: revision.id, revision: revision.revision }],
      baseline: rebaseEditorDocument(raw, state.doc, raw).toJSON(),
    };
    await expect(apply.commitEditorRevision({ ...request, decision: { mode: 'accept' } }))
      .rejects.toThrow('本地编辑与待接受的修订在同一块重叠');
    const saved = await apply.commitEditorRevision(request);
    expect(store.getPendingRevisions('doc')).toEqual([revision]);
    expect(schema.nodeFromJSON(saved.content).child(1).textContent).toBe('');
    expect(schema.nodeFromJSON(saved.content).child(0).eq(raw.child(0))).toBe(true);
    const savedVersion = store.getLatestVersion('doc');
    if (!savedVersion) throw new Error('Missing saved version');
    const accepted = await apply.commitEditorRevision({
      ...request, expectedVersionNumber: savedVersion.version_number,
      baseline: saved.content, decision: { mode: 'accept' },
    });
    expect(schema.nodeFromJSON(accepted.content).child(1).textContent).toBe('新增段落');
    expect(store.getPendingRevisions('doc')).toEqual([]);
  });
});
