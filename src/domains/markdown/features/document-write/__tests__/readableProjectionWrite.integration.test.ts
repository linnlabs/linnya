import Database from 'better-sqlite3';
import { Transform } from 'prosemirror-transform';
import { parseMarkdownDocJson, workspaceMarkdownSchemaLite, type MarkdownDocJson } from '../../normalization/runtime';
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
  const normalizer = new MarkdownNormalizationService(store);
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

function colorText(document: MarkdownDocJson, words: readonly string[]): MarkdownDocJson {
  const tr = new Transform(workspaceMarkdownSchemaLite.nodeFromJSON(document));
  tr.doc.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    for (const word of words) {
      const index = node.text.indexOf(word);
      if (index < 0) continue;
      for (const [type, color] of [['textColor', 'red_text'], ['textHighlight', 'bright_yellow']]) {
        tr.addMark(position + index, position + index + word.length, tr.doc.type.schema.marks[type].create({ color }));
      }
    }
  });
  return parseMarkdownDocJson(tr.doc.toJSON());
}

function coloredText(document: MarkdownDocJson): string[] {
  const texts: string[] = [];
  workspaceMarkdownSchemaLite.nodeFromJSON(document).descendants(node => {
    if (node.isText && node.marks.some(mark => mark.type.name === 'textColor')) {
      expect(node.marks.find(mark => mark.type.name === 'textColor')?.attrs.color).toBe('red_text');
      expect(node.marks.find(mark => mark.type.name === 'textHighlight')?.attrs.color).toBe('bright_yellow');
      texts.push(node.text ?? '');
    }
  });
  return texts;
}

it.each([
  { before: '重点和原句。', after: '重点和改写后的句子。', words: ['重点'], styled: ['重点'] },
  { before: '重点和原句。', after: '**重点**和原句。', words: ['重点'], styled: ['重点'] },
  { before: '重点和原句。', after: '`重点`和原句。', words: ['重点'], styled: [] },
  { before: '重点。', after: '新增重点补充。', words: ['重点'], styled: ['重点'] },
  { before: '重点。', after: '重中之重。', words: ['重点'], styled: ['重'] },
  { before: '😀和重点。', after: '😁与重点。', words: ['😀', '重点'], styled: ['重点'] },
  { before: '👩‍💻与重点。', after: '👩‍🔬和重点。', words: ['👩‍💻', '重点'], styled: ['重点'] },
  { before: '旧词。', after: '新增。', words: ['旧词'], styled: [] },
  { before: '| 名称 | 数值 |\n| --- | --- |\n| 重点 | 10 |\n| 次要 | 20 |',
    after: '| 名称 | 数值 |\n| --- | --- |\n| 新增 | 5 |\n| 重点 | 12 |\n| 次要 | 20 |', words: ['重点'], styled: ['重点'] },
])('file write → Pending → 接受 → 读回保留原文呈现：$after', async ({ before, after, words, styled }) => {
  const { store, normalizer, read, write } = setup();
  const created = await buildMarkdownDocumentFromText({ markdown: before, normalizer, resolveCitationSources: async () => [] });
  store.createDocument('doc', colorText(parseMarkdownDocJson(created.content), words));
  const original = store.getDocument('doc');
  expect((await write(read()?.text ?? '')).edits).toEqual([]);
  await write(after);
  // Pending 期间基线没有被偷偷覆盖；多次更新提议始终从当前真实基线恢复样式。
  expect(store.getDocument('doc')).toEqual(original);
  const accept = new PendingRevisionApplyService(store);
  await accept.commitEditorRevision({ documentId: 'doc', expectedVersionNumber: store.getLatestVersion('doc')!.version_number,
    expectedPending: store.getPendingRevisions('doc').map(({ id, revision }) => ({ id, revision })),
    baseline: original, decision: { mode: 'accept' } });
  expect(coloredText(store.getDocument('doc'))).toEqual(styled);
  expect(store.getPendingRevisions('doc')).toEqual([]);
  expect((await write(read()?.text ?? '')).edits).toEqual([]);
});

it('取消、拒绝和继续修改 Pending 不丢失或复活已删除的呈现', async () => {
  const { store, normalizer, read, write } = setup();
  const created = await buildMarkdownDocumentFromText({ markdown: '重点和原句。', normalizer, resolveCitationSources: async () => [] });
  store.createDocument('doc', colorText(parseMarkdownDocJson(created.content), ['重点']));
  const original = store.getDocument('doc');
  const current = read()?.text ?? '';
  await write('重点和改句。');
  await write(current);
  expect(store.getPendingRevisions('doc')).toEqual([]);
  expect(store.getDocument('doc')).toEqual(original);
  await write('重点和又一次改句。');
  const apply = new PendingRevisionApplyService(store);
  const request = () => ({ documentId: 'doc', expectedVersionNumber: store.getLatestVersion('doc')!.version_number,
    expectedPending: store.getPendingRevisions('doc').map(({ id, revision }) => ({ id, revision })), baseline: store.getDocument('doc') });
  await apply.commitEditorRevision({ ...request(), decision: { mode: 'reject' } });
  expect(store.getDocument('doc')).toEqual(original);
  await write('重点和改句。');
  await write('普通的新内容。');
  await apply.commitEditorRevision({ ...request(), decision: { mode: 'accept' } });
  expect(coloredText(store.getDocument('doc'))).toEqual([]);
});

it('未变行内公式按语义保留呈现，换掉公式后不迁移颜色，也不把新节点 ID 当作改写', async () => {
  const { store, normalizer, write } = setup();
  const created = await buildMarkdownDocumentFromText({ markdown: '$x$ 与原句。', normalizer, resolveCitationSources: async () => [] });
  const content = parseMarkdownDocJson(created.content);
  const formula = content.content[0].content?.[0]?.content?.find(node => node.type === 'inlineLatex');
  if (!formula) throw new Error('Missing formula');
  formula.marks = [{ type: 'textColor', attrs: { color: 'red_text' } }];
  store.createDocument('doc', content);
  const apply = new PendingRevisionApplyService(store);
  for (const [markdown, preserved] of [['$x$ 与改句。', true], ['$y$ 与再改句。', false]] as const) {
    await write(markdown);
    const result = await apply.commitEditorRevision({ documentId: 'doc', expectedVersionNumber: store.getLatestVersion('doc')!.version_number,
      expectedPending: store.getPendingRevisions('doc').map(({ id, revision }) => ({ id, revision })),
      baseline: store.getDocument('doc'), decision: { mode: 'accept' } });
    expect(result.content.content[0].content?.[0]?.content?.find(node => node.type === 'inlineLatex')?.marks?.some(mark => mark.type === 'textColor') ?? false)
      .toBe(preserved);
  }
});
