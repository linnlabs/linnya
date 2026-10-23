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

  it('preserves literal brackets, Unicode formulae and presentation through real pending acceptance', async () => {
    const { store, normalizer, read, write } = setup();
    const created = await buildMarkdownDocumentFromText({
      markdown: '&#91;1\\] 张三的研究。\n\n$$\n\\text{中文研究} + α\n$$\n\n需要修改。',
      normalizer, resolveCitationSources: async () => [],
    });
    store.createDocument('doc', created.content);
    const initial = store.getDocument('doc');
    initial.content[2].attrs = { ...initial.content[2].attrs, textColor: 'red', backgroundColor: 'yellow' };
    const paragraph = initial.content[2].content?.[0];
    if (!paragraph) throw new Error('Missing paragraph');
    paragraph.attrs = { ...paragraph.attrs, textAlign: 'center' };
    store.updateDocument('doc', initial);
    const current = read()?.text ?? '';
    expect(current).toContain('中文研究');
    expect((await write(current)).edits).toEqual([]);
    await write(current.replace('需要修改', '已经修改'));
    await new PendingRevisionApplyService(store).commitEditorRevision({
      documentId: 'doc', expectedVersionNumber: store.getLatestVersion('doc')!.version_number,
      expectedPending: store.getPendingRevisions('doc').map(({ id, revision }) => ({ id, revision })),
      baseline: store.getDocument('doc'), decision: { mode: 'accept' },
    });
    const final = store.getDocument('doc');
    expect(final.content[0].content?.[0].type).toBe('baseBlock');
    expect(final.content[1].content?.[0]).toMatchObject({ type: 'latexBlock', attrs: { latexSource: '\\text{中文研究} + α' } });
    expect(final.content[2]).toMatchObject({ attrs: { textColor: 'red', backgroundColor: 'yellow' }, content: [{ attrs: { textAlign: 'center' } }] });
  });

  it('round-trips existing images, snapshots copies and rejects missing or mixed sources atomically', async () => {
    const { store, read, write } = setup();
    store.createDocument('doc', { type: 'doc', content: [
      { type: 'rootBlock', attrs: { id: 'image-root' }, content: [{ type: 'imageBlock', attrs: {
        id: 'image-one', src: 'media://existing.png', alt: '原始文件.png', width: 600, height: 400, alignment: 'right',
      } }] },
      { type: 'rootBlock', attrs: { id: 'text-root' }, content: [{ type: 'baseBlock', attrs: { id: 'text-one' }, content: [{ type: 'text', text: '分隔段落' }] }] },
    ] });
    const current = read()?.text ?? '';
    expect(current).toContain('![](<linnya-image://image-one>)');
    expect((await write(current)).edits).toEqual([]);
    await write(current.replace('![]', '![中文题注]'));
    expect(store.getPendingRevisions('doc')).toHaveLength(1);
    const accept = () => new PendingRevisionApplyService(store).commitEditorRevision({
      documentId: 'doc', expectedVersionNumber: store.getLatestVersion('doc')!.version_number,
      expectedPending: store.getPendingRevisions('doc').map(({ id, revision }) => ({ id, revision })),
      baseline: store.getDocument('doc'), decision: { mode: 'accept' },
    });
    await accept();
    expect(store.getDocument('doc').content[0].content?.[0]).toMatchObject({ type: 'imageBlock', attrs: {
      id: 'image-one', caption: '中文题注', src: 'media://existing.png', alt: '原始文件.png', width: 600, height: 400, alignment: 'right',
    } });
    await write(`${read()?.text}\n\n![副本](linnya-image://image-one)`);
    const pending = store.getPendingRevisions('doc')[0];
    const snapshot = JSON.parse(pending.meta_json ?? '{}');
    expect(snapshot.image.id).not.toBe('image-one');
    expect(snapshot.image.src).toBe('media://existing.png');
    await accept();
    expect(store.getDocument('doc').content[2].content?.[0].attrs?.caption).toBe('副本');
    const unchanged = store.getLatestVersion('doc');
    await expect(write('正文修改\n\n![坏引用](linnya-image://missing)')).rejects.toThrow('MARKDOWN_IMAGE_INVALID');
    await expect(write('正文 ![混排](linnya-image://image-one)')).rejects.toThrow('MARKDOWN_IMAGE_INVALID');
    await expect(write('![远程](https://example.com/image.png)')).rejects.toThrow('MARKDOWN_IMAGE_INVALID');
    expect(store.getLatestVersion('doc')).toEqual(unchanged);
    expect(store.getPendingRevisions('doc')).toEqual([]);
  });

});
