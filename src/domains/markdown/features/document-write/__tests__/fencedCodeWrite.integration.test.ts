import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { CORE_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/core.schema';
import { ASSET_LEDGER_SCHEMAS } from 'src/domains/assets/features/asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema';
import { MARKDOWN_DOCUMENT_SCHEMAS } from '../../document-storage/infrastructure/sqlite/schemas/document.schema';
import { PENDING_REVISION_SCHEMAS } from '../../document-storage/infrastructure/sqlite/schemas/blocks/pending-revision.schema';
import { BLOCK_HISTORY_SCHEMAS } from '../../document-storage/infrastructure/sqlite/schemas/blocks/block-history.schema';
import { IMAGE_BLOCK_SCHEMAS } from '../../document-storage/infrastructure/sqlite/schemas/blocks/image.schema';
import { MarkdownDocumentService } from '../../document-storage';
import { importMarkdownToDocJson, type MarkdownDocJson } from '../../normalization';
import { PendingRevisionApplyService } from '../../pending-revisions';
import { readMarkdownVfsContent } from '../../document-read';
import { createMarkdownReadDatabase } from '../../../infrastructure/sqlite/markdownReadDatabaseAdapter';
import { buildMarkdownDocumentFromText, markdownTextDocumentBuilder } from '../orchestration/buildMarkdownDocumentFromText';
import { writeMarkdownDocumentFromText } from '../orchestration/writeMarkdownDocumentFromText';

const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));

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
  const write = (targetText: string) => writeMarkdownDocumentFromText({
    documentStore: store, documentId: 'doc', targetText, toolName: 'write_file',
    annotationAdmission: { author: 'AI', meta: { source: 'agent' } },
    touchDocumentUpdatedAt: () => undefined,
  });
  return { store, normalizer, read, write };
}

function expectBody(doc: MarkdownDocJson | null, body: string): void {
  expect(doc?.content).toHaveLength(3);
  expect(doc?.content[1]?.content?.[0]).toMatchObject({
    type: 'codeBlock', attrs: { language: 'text' },
    content: [{ type: 'text', text: body }],
  });
  expect(doc?.content[0]?.content?.[0]?.content?.[0]?.text).toBe('Before');
  expect(doc?.content[2]?.content?.[0]?.content?.[0]?.text).toBe('After');
}

describe('fenced code create → current → pending → accept → current', () => {
  it.each(['````', '~~~'])('preserves literal content and block identities with %s', async fence => {
    const { store, normalizer, read, write } = setup();
    const body = '\n  BEGIN \t\n```\n# example\n[@ABC234]\n<!-- literal -->\n```\n  END  \n\n';
    const markdown = `Before\n\n${fence}text\n${body}\n${fence}\n\nAfter`;
    const created = await buildMarkdownDocumentFromText({
      markdown, normalizer,
      resolveCitationSources: () => { throw new Error('code example must not resolve citations'); },
    });
    store.createDocument('doc', created.content);
    expectBody(store.getDocument('doc'), body);
    const originalIds = store.getDocument('doc').content.map(root => root.attrs?.id);
    const current = read();
    expect(current?.metadata.pendingCount).toBe(0);
    expectBody((await importMarkdownToDocJson(current?.text ?? '')).docJson, body);

    const unchanged = await write(current?.text ?? '');
    expect(unchanged.edits).toEqual([]);
    expect(unchanged.pendingCount).toBe(0);

    const editedBody = body.replace('  END  ', '  UPDATED  ');
    const update = await write(markdown.replace('  END  ', '  UPDATED  '));
    expect(update.edits.map(edit => edit.operation)).toEqual(['update']);
    expectBody(store.getDocument('doc'), body);
    expect(read()?.metadata.pendingCount).toBe(1);
    expectBody((await importMarkdownToDocJson(read()?.text ?? '')).docJson, editedBody);

    const version = store.getLatestVersion('doc');
    if (!version) throw new Error('Missing test document');
    await new PendingRevisionApplyService(store).commitEditorRevision({
      documentId: 'doc', expectedVersionNumber: version.version_number,
      expectedPending: store.getPendingRevisions('doc').map(({ id, revision }) => ({ id, revision })),
      baseline: store.getDocument('doc'), decision: { mode: 'accept' },
    });
    expect(store.getPendingRevisions('doc')).toEqual([]);
    expectBody(store.getDocument('doc'), editedBody);
    expect(store.getDocument('doc').content.map(root => root.attrs?.id)).toEqual(originalIds);
    expectBody((await importMarkdownToDocJson(read()?.text ?? '')).docJson, editedBody);
    expect((await write(read()?.text ?? '')).edits).toEqual([]);
  });
});
