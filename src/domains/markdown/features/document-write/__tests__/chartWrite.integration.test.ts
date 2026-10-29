import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MarkdownChartSpecInvalidError,
  admitMarkdownChartSpec,
  encodeMarkdownChartFence,
} from '@app/schemas';
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

function chart(values: number[], extra: Record<string, unknown> = {}): string {
  const result = admitMarkdownChartSpec({
    chartType: 'bar',
    title: '各季度销量',
    categories: ['Q1', 'Q2', 'Q3'],
    series: [{ name: '2025', values }],
    ...extra,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return encodeMarkdownChartFence(result.spec);
}

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
  const create = async (markdown: string) => {
    const created = await buildMarkdownDocumentFromText({
      markdown, normalizer,
      resolveCitationSources: () => { throw new Error('charts must not resolve citations'); },
    });
    store.createDocument('doc', created.content);
  };
  const decide = async (decision: { mode: 'accept' | 'reject'; blockId?: string }) => {
    const version = store.getLatestVersion('doc');
    if (!version) throw new Error('Missing test document');
    await new PendingRevisionApplyService(store).commitEditorRevision({
      documentId: 'doc', expectedVersionNumber: version.version_number,
      expectedPending: store.getPendingRevisions('doc').map(({ id, revision }) => ({ id, revision })),
      baseline: store.getDocument('doc'), decision,
    });
  };
  return { db, store, read, write, create, decide };
}

const innerTypes = (doc: MarkdownDocJson) => doc.content.map(root => root.content?.[0]?.type);
const rootIds = (doc: MarkdownDocJson) => doc.content.map(root => root.attrs?.id);
const specOf = (doc: MarkdownDocJson, index: number) => doc.content[index]?.content?.[0]?.attrs?.spec;

describe('图表块：创建 → 读取 → 写入 → Pending → 接受/拒绝', () => {
  it('创建后以 chartBlock 持久化，读取投影即 canonical 围栏，且再导入语义一致', async () => {
    const { store, read, write, create } = setup();
    const markdown = `前文\n\n${chart([10, 20, 30])}\n\n后文`;
    await create(markdown);

    const doc = store.getDocument('doc');
    expect(innerTypes(doc)).toEqual(['baseBlock', 'chartBlock', 'baseBlock']);
    expect(specOf(doc, 1)).toMatchObject({ chartType: 'bar', series: [{ name: '2025', values: [10, 20, 30] }] });

    const current = read();
    expect(current?.text).toBe(markdown);
    const reimported = (await importMarkdownToDocJson(current?.text ?? '')).docJson;
    expect(reimported && specOf(reimported, 1)).toEqual(specOf(doc, 1));

    const unchanged = await write(current?.text ?? '');
    expect(unchanged.edits).toEqual([]);
    expect(unchanged.pendingCount).toBe(0);
  });

  it('只调整图表 JSON 的键序、缩进或显式默认值，不制造修订', async () => {
    const { store, write, create } = setup();
    await create(`前文\n\n${chart([10, 20, 30])}`);
    const reformatted = '前文\n\n```linnya-chart\n{ "series":[{"values":[10,20,30],"name":"2025"}],"size":"medium",\n"title":"各季度销量","categories":["Q1","Q2","Q3"],"chartType":"bar" }\n```';

    const result = await write(reformatted);
    expect(result.edits).toEqual([]);
    expect(store.getPendingRevisions('doc')).toEqual([]);
  });

  it('修改一个数值只产生该块的一条 update；接受后保留块身份，拒绝后保持基线', async () => {
    const { store, read, write, create, decide } = setup();
    await create(`前文\n\n${chart([10, 20, 30])}\n\n后文`);
    const originalIds = rootIds(store.getDocument('doc'));

    const update = await write(`前文\n\n${chart([10, 25, 30])}\n\n后文`);
    expect(update.edits.map(edit => edit.operation)).toEqual(['update']);
    expect(update.edits[0]?.blockId).toBe(originalIds[1]);
    expect(specOf(store.getDocument('doc'), 1)).toMatchObject({ series: [{ values: [10, 20, 30] }] });
    expect(read()?.text).toContain('[10, 25, 30]');
    expect(read()?.metadata.pendingCount).toBe(1);

    await decide({ mode: 'reject' });
    expect(store.getPendingRevisions('doc')).toEqual([]);
    expect(specOf(store.getDocument('doc'), 1)).toMatchObject({ series: [{ values: [10, 20, 30] }] });

    await write(`前文\n\n${chart([10, 25, 30])}\n\n后文`);
    await decide({ mode: 'accept' });
    expect(store.getPendingRevisions('doc')).toEqual([]);
    expect(specOf(store.getDocument('doc'), 1)).toMatchObject({ series: [{ values: [10, 25, 30] }] });
    expect(rootIds(store.getDocument('doc'))).toEqual(originalIds);
    expect((await write(read()?.text ?? '')).edits).toEqual([]);
  });

  it('新增图表：占位块 → 接受后成为 chartBlock；拒绝则占位块被移除', async () => {
    const accepted = setup();
    await accepted.create('前文\n\n后文');
    const insert = await accepted.write(`前文\n\n${chart([1, 2, 3])}\n\n后文`);
    expect(insert.edits.map(edit => edit.operation)).toEqual(['insert']);
    expect(innerTypes(accepted.store.getDocument('doc'))).toEqual(['baseBlock', 'baseBlock', 'baseBlock']);
    const placeholderId = insert.edits[0]?.blockId;

    await accepted.decide({ mode: 'accept' });
    const doc = accepted.store.getDocument('doc');
    expect(innerTypes(doc)).toEqual(['baseBlock', 'chartBlock', 'baseBlock']);
    expect(rootIds(doc)[1]).toBe(placeholderId);

    const rejected = setup();
    await rejected.create('前文\n\n后文');
    await rejected.write(`前文\n\n${chart([1, 2, 3])}\n\n后文`);
    await rejected.decide({ mode: 'reject' });
    expect(innerTypes(rejected.store.getDocument('doc'))).toEqual(['baseBlock', 'baseBlock']);
  });

  it('删除图表是 delete 修订；接受后移除，拒绝则保留', async () => {
    const accepted = setup();
    await accepted.create(`前文\n\n${chart([1, 2, 3])}\n\n后文`);
    const removal = await accepted.write('前文\n\n后文');
    expect(removal.edits.map(edit => edit.operation)).toEqual(['delete']);
    expect(innerTypes(accepted.store.getDocument('doc'))).toEqual(['baseBlock', 'chartBlock', 'baseBlock']);
    await accepted.decide({ mode: 'accept' });
    expect(innerTypes(accepted.store.getDocument('doc'))).toEqual(['baseBlock', 'baseBlock']);

    const rejected = setup();
    await rejected.create(`前文\n\n${chart([1, 2, 3])}\n\n后文`);
    await rejected.write('前文\n\n后文');
    await rejected.decide({ mode: 'reject' });
    expect(innerTypes(rejected.store.getDocument('doc'))).toEqual(['baseBlock', 'chartBlock', 'baseBlock']);
  });

  it('同一块在图表与普通正文之间转换', async () => {
    const toText = setup();
    await toText.create(`前文\n\n${chart([1, 2, 3])}`);
    const chartId = rootIds(toText.store.getDocument('doc'))[1];
    const update = await toText.write('前文\n\n结论改写为文字说明。');
    expect(update.edits.map(edit => edit.operation)).toEqual(['update']);
    expect(update.edits[0]?.blockId).toBe(chartId);
    await toText.decide({ mode: 'accept' });
    expect(innerTypes(toText.store.getDocument('doc'))).toEqual(['baseBlock', 'baseBlock']);

    const toChart = setup();
    await toChart.create('前文\n\n待补充的段落');
    const paragraphId = rootIds(toChart.store.getDocument('doc'))[1];
    await toChart.write(`前文\n\n${chart([4, 5, 6])}`);
    await toChart.decide({ mode: 'accept' });
    const doc = toChart.store.getDocument('doc');
    expect(innerTypes(doc)).toEqual(['baseBlock', 'chartBlock']);
    expect(rootIds(doc)[1]).toBe(paragraphId);
  });

  it('同一块继续编辑：Pending 身份不变，只更新 revision', async () => {
    const { store, write, create } = setup();
    await create(`前文\n\n${chart([1, 2, 3])}`);
    await write(`前文\n\n${chart([1, 2, 4])}`);
    const [first] = store.getPendingRevisions('doc');
    await write(`前文\n\n${chart([1, 2, 5])}`);
    const pendings = store.getPendingRevisions('doc');
    expect(pendings).toHaveLength(1);
    expect(pendings[0]?.id).toBe(first?.id);
    expect(pendings[0]?.new_markdown).toContain('[1, 2, 5]');
  });

  it('无效专属围栏：整次写入失败，没有任何半提交（包括同次的合法正文修改）', async () => {
    const { store, write, create } = setup();
    await create(`前文\n\n${chart([1, 2, 3])}\n\n后文`);
    const versionBefore = store.getLatestVersion('doc')?.version_number;

    const invalid = '```linnya-chart\n{"chartType":"bar","categories":["a","b"],"series":[{"name":"s","values":[1]}]}\n```';
    await expect(write(`前文被改写\n\n${invalid}\n\n后文`)).rejects.toBeInstanceOf(MarkdownChartSpecInvalidError);

    expect(store.getPendingRevisions('doc')).toEqual([]);
    expect(store.getLatestVersion('doc')?.version_number).toBe(versionBefore);
    expect(innerTypes(store.getDocument('doc'))).toEqual(['baseBlock', 'chartBlock', 'baseBlock']);
  });

  it('文档里已有的普通 chart / echarts 代码围栏不受影响：Agent 只改相邻段落时仅产生一条正文修订', async () => {
    const { store, write, create, decide } = setup();
    const yaml = '```chart\ntype: bar\ndata:\n  labels: [a, b]\n```';
    const option = '```echarts\n{"series":[{"type":"bar"}]}\n```';
    await create(`前文\n\n${yaml}\n\n${option}\n\n${chart([1, 2, 3])}`);
    const originalIds = rootIds(store.getDocument('doc'));

    const result = await write(`前文已修订\n\n${yaml}\n\n${option}\n\n${chart([1, 2, 3])}`);
    expect(result.edits.map(edit => edit.operation)).toEqual(['update']);
    expect(result.edits[0]?.blockId).toBe(originalIds[0]);

    await decide({ mode: 'accept' });
    const doc = store.getDocument('doc');
    expect(innerTypes(doc)).toEqual(['baseBlock', 'codeBlock', 'codeBlock', 'chartBlock']);
    expect(doc.content[1]?.content?.[0]?.attrs?.language).toBe('chart');
    expect(doc.content[2]?.content?.[0]?.attrs?.language).toBe('echarts');
    expect(rootIds(doc)).toEqual(originalIds);
  });

  it('图表规格里的 [@ref] 样式文本只是标题文字：不进入引用解析，也不变成引用来源', async () => {
    const { store, read, create } = setup();
    await create(`前文\n\n${chart([1, 2, 3], { title: '示例 [@ABC234] 不是引用' })}`);

    expect(specOf(store.getDocument('doc'), 1)).toMatchObject({ title: '示例 [@ABC234] 不是引用' });
    expect(read()?.text).toContain('示例 [@ABC234] 不是引用');
  });

  it('图表后的批注跟随图表块身份，写入相同文本不产生变化', async () => {
    const { store, read, write, create } = setup();
    await create(`${chart([1, 2, 3])}\n\n<!-- 口径需核对 -->`);
    expect(store.getDocument('doc').content[0]?.attrs?.annotations).toHaveLength(1);

    const unchanged = await write(read()?.text ?? '');
    expect(unchanged.edits).toEqual([]);
    expect(unchanged.createdAnnotationIds).toEqual([]);
    expect(store.getPendingRevisions('doc')).toEqual([]);
  });
});
