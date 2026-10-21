import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { CORE_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/core.schema';
import { ASSET_LEDGER_SCHEMAS } from 'src/domains/assets/features/asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema';
import { MARKDOWN_DOCUMENT_SCHEMAS } from '../../document-storage/infrastructure/sqlite/schemas/document.schema';
import { PENDING_REVISION_SCHEMAS } from '../../document-storage/infrastructure/sqlite/schemas/blocks/pending-revision.schema';
import { BLOCK_HISTORY_SCHEMAS } from '../../document-storage/infrastructure/sqlite/schemas/blocks/block-history.schema';
import { IMAGE_BLOCK_SCHEMAS } from '../../document-storage/infrastructure/sqlite/schemas/blocks/image.schema';
import { MarkdownDocumentService } from '../../document-storage';
import { MarkdownNormalizationService } from '../../normalization';
import { PendingRevisionApplyService } from '../../pending-revisions';
import { readMarkdownVfsContent } from '../../document-read';
import { createMarkdownReadDatabase } from '../../../infrastructure/sqlite/markdownReadDatabaseAdapter';
import { buildMarkdownDocumentFromText } from '../orchestration/buildMarkdownDocumentFromText';
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
  const normalizer = new MarkdownNormalizationService(db, store);
  const read = () => readMarkdownVfsContent({ db: createMarkdownReadDatabase(db), documentId: 'doc' });
  const write = (targetText: string) => writeMarkdownDocumentFromText({
    documentStore: store, documentId: 'doc', targetText, toolName: 'write_file',
    annotationAdmission: { author: 'AI', meta: { source: 'agent' } },
    touchDocumentUpdatedAt: () => undefined,
  });
  return { store, normalizer, read, write };
}

describe('readable Markdown projection create → pending → accept → current', () => {
  it('keeps lists, table alignment and literal prose stable without creating normalization-only edits', async () => {
    const { store, normalizer, read, write } = setup();
    const markdown = 'Clause 202(c) has foo_bar and 10 > 2.\n\n3) first\n4) second\n\nPause.\n\n7. third\n\n| Name | Value |\n| :--- | ---: |\n| Alpha | 12 |';
    const created = await buildMarkdownDocumentFromText({
      markdown, normalizer, resolveCitationSources: async () => [],
    });
    store.createDocument('doc', created.content);
    const current = read()?.text ?? '';
    expect(current).toContain('202(c)');
    expect(current).toContain('3) first');
    expect(current).toContain('4) second');
    expect(current).toContain('7. third');
    expect(current).toContain('| :--- | ---: |');
    expect((await write(current)).edits).toEqual([]);
    const edited = current.replace('second', 'revised');
    expect((await write(edited)).edits).toHaveLength(1);
    expect(read()?.text).toBe(edited);
    const version = store.getLatestVersion('doc');
    if (!version) throw new Error('Missing test document');
    await new PendingRevisionApplyService(store).commitEditorRevision({
      documentId: 'doc', expectedVersionNumber: version.version_number,
      expectedPending: store.getPendingRevisions('doc').map(({ id, revision }) => ({ id, revision })),
      baseline: store.getDocument('doc'), decision: { mode: 'accept' },
    });
    expect(read()?.text).toBe(edited);
    expect((await write(edited)).edits).toEqual([]);
  });
  it('preserves tight/loose boundaries by target position through spacing-only edits, cancellation and acceptance', async () => {
    const { store, normalizer, read, write } = setup();
    const markdown = '- repeat\n- repeat\n\n- repeat\n  + nested\n\nParagraph.\n\n0) restart\n1) next';
    const created = await buildMarkdownDocumentFromText({ markdown, normalizer, resolveCitationSources: async () => [] });
    store.createDocument('doc', created.content);
    expect(read()?.text).toBe(markdown);
    expect((await write(markdown)).edits).toEqual([]);

    // 相同文字的三项不能通过 Markdown 字符串 key 共享间隔；只改变第二项的间隔。
    const loose = markdown.replace('- repeat\n- repeat', '- repeat\n\n- repeat');
    expect((await write(loose)).edits).toHaveLength(1);
    expect(read()?.text).toBe(loose);
    expect((await write(loose)).edits).toEqual([]);
    await write(markdown);
    expect(store.getPendingRevisions('doc')).toHaveLength(0);
    expect(read()?.text).toBe(markdown);

    await write(loose);
    const version = store.getLatestVersion('doc');
    if (!version) throw new Error('Missing test document');
    await new PendingRevisionApplyService(store).commitEditorRevision({
      documentId: 'doc', expectedVersionNumber: version.version_number,
      expectedPending: store.getPendingRevisions('doc').map(({ id, revision }) => ({ id, revision })),
      baseline: store.getDocument('doc'), decision: { mode: 'accept' },
    });
    expect(read()?.text).toBe(loose);
    expect((await write(loose)).edits).toEqual([]);
  });

});
