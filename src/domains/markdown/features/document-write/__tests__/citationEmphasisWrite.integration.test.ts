import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { CORE_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/core.schema';
import { ASSET_LEDGER_SCHEMAS } from 'src/domains/assets/features/asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema';
import { MARKDOWN_DOCUMENT_SCHEMAS } from '../../document-storage/infrastructure/sqlite/schemas/document.schema';
import { PENDING_REVISION_SCHEMAS } from '../../document-storage/infrastructure/sqlite/schemas/blocks/pending-revision.schema';
import { BLOCK_HISTORY_SCHEMAS } from '../../document-storage/infrastructure/sqlite/schemas/blocks/block-history.schema';
import { IMAGE_BLOCK_SCHEMAS } from '../../document-storage/infrastructure/sqlite/schemas/blocks/image.schema';
import { MarkdownDocumentService } from '../../document-storage';
import { attachCitationNodesToDocJson, importMarkdownToDocJson, type MarkdownDocJson } from '../../normalization';
import { PendingRevisionApplyService } from '../../pending-revisions';
import { readMarkdownVfsContent } from '../../document-read';
import { createMarkdownReadDatabase } from '../../../infrastructure/sqlite/markdownReadDatabaseAdapter';
import { buildMarkdownDocumentFromText, markdownTextDocumentBuilder } from '../orchestration/buildMarkdownDocumentFromText';
import { buildMarkdownPendingCitationMetadata } from '../orchestration/buildMarkdownPendingCitationMetadata';
import { writeMarkdownDocumentFromText } from '../orchestration/writeMarkdownDocumentFromText';
import type { CitationSource } from '../../../../citation';
import { extractCanonicalCitationRefs } from '../../../../citation';

const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));

const source: CitationSource = {
  sourceType: 'web', ref: 'Abc234', url: 'https://example.com/report',
  title: 'A source snapshot', snippet: 'The original excerpt',
};
const resolveSources = async () => [source];

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
  const normalizer = markdownTextDocumentBuilder;
  const read = () => readMarkdownVfsContent({ db: createMarkdownReadDatabase(db), documentId: 'doc' });
  const write = async (targetText: string) => writeMarkdownDocumentFromText({
    documentStore: store, documentId: 'doc', targetText, toolName: 'write_file',
    pendingMetaByMarkdown: await buildMarkdownPendingCitationMetadata(targetText, resolveSources),
    annotationAdmission: { author: 'AI', meta: { source: 'agent' } },
    touchDocumentUpdatedAt: () => undefined,
  });
  return { store, normalizer, read, write };
}

function inlineFacts(doc: MarkdownDocJson) {
  return doc.content[0]?.content?.[0]?.content?.map(node => ({
    type: node.type,
    text: node.text,
    marks: node.marks,
    ...(node.type === 'citationNode' ? { ref: node.attrs?.ref, title: node.attrs?.title, snippet: node.attrs?.snippet } : {}),
  }));
}

describe('citation emphasis create → current → pending → accept → current', () => {
  it.each(['\n\n其他 `text`', '\n# 其他 `text`'])(
    '跨块的字面反引号经过创建、修订及接受后保持来源快照：%s', async boundary => {
    const { store, normalizer, read, write } = setup();
    const initial = '`[@Abc234]' + boundary;
    const created = await buildMarkdownDocumentFromText({
      markdown: initial, normalizer, resolveCitationSources: resolveSources,
    });
    store.createDocument('doc', created.content);
    expect(extractCanonicalCitationRefs(read()?.text ?? '')).toEqual(['Abc234']);
    const result = await write('`[@Abc234]\n\n更新的 `text`\n\n示例 `[@Def567]`');
    expect(result.edits.length).toBeGreaterThan(0);
    expect(extractCanonicalCitationRefs(read()?.text ?? '')).toEqual(['Abc234']);
    const version = store.getLatestVersion('doc');
    if (!version) throw new Error('Missing test version');
    await new PendingRevisionApplyService(store).commitEditorRevision({
      documentId: 'doc', expectedVersionNumber: version.version_number,
      expectedPending: store.getPendingRevisions('doc').map(({ id, revision }) => ({ id, revision })),
      baseline: store.getDocument('doc'), decision: { mode: 'accept' },
    });
    const accepted = read();
    expect(accepted?.metadata.pendingCount).toBe(0);
    expect(extractCanonicalCitationRefs(accepted?.text ?? '')).toEqual(['Abc234']);
    expect(JSON.stringify(store.getDocument('doc'))).toContain(source.snippet);
    expect((await write(accepted?.text ?? '')).edits).toEqual([]);
  });

  it.each([
    '**关键说明 [@Abc234]** 后续正文',
    '**关键说明** [@Abc234] 后续正文',
    '**关键 [@Abc234] 说明** 后续正文',
    '***关键 [@Abc234] 说明*** 后续正文',
    '**关键** `code` **[@Abc234] 说明** 后续正文',
    '`x\\` [@Abc234] `y` 关键说明',
  ])('preserves mark ranges and citations through acceptance: %s', async initial => {
    const { store, normalizer, read, write } = setup();
    const created = await buildMarkdownDocumentFromText({ markdown: initial, normalizer, resolveCitationSources: resolveSources });
    store.createDocument('doc', created.content);
    expect(read()?.text).toBe(initial);
    const updated = initial.replace('关键', '更新后的关键');
    const result = await write(updated);
    expect(result.edits).toHaveLength(1);
    expect(read()?.text).toBe(updated);
    const version = store.getLatestVersion('doc');
    if (!version) throw new Error('Missing test version');
    await new PendingRevisionApplyService(store).commitEditorRevision({
      documentId: 'doc', expectedVersionNumber: version.version_number,
      expectedPending: store.getPendingRevisions('doc').map(({ id, revision }) => ({ id, revision })),
      baseline: store.getDocument('doc'), decision: { mode: 'accept' },
    });
    const accepted = read();
    expect(accepted?.metadata.pendingCount).toBe(0);
    expect(accepted?.text).toBe(updated);
    const imported = (await importMarkdownToDocJson(accepted?.text ?? '')).docJson;
    if (!imported) throw new Error('Missing parsed document');
    const reread = attachCitationNodesToDocJson(imported, {
      Abc234: { sourceType: 'web', url: 'https://example.com/report', title: source.title, snippet: source.snippet },
    });
    expect(inlineFacts(reread)).toEqual(inlineFacts(store.getDocument('doc')));
    expect((await write(accepted?.text ?? '')).edits).toEqual([]);
  });
});
