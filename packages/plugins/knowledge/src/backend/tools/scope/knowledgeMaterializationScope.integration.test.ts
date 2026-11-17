import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { AssembleDocumentsToolOutputSchema, KnowledgeSearchResultSchema } from '@app/schemas';
import { ToolCallIdSchema } from '@linnlabs/linnkit/contracts';
import { DatabaseService } from 'src/electron-main/services/database';
import type { KnowledgeBaseService } from '../../application/knowledgeBaseService';
import { GraphSearchService } from '../../graph/application/graphSearchService';
import { BetterSqliteMetadataRepository } from '../../infrastructure/sqlite/better-sqlite-metadata.repository';
import { BetterSqliteKnowledgeGraphRepository } from '../../graph/infrastructure/better-sqlite-knowledge-graph.repository';
import { PluginStateService } from 'src/features/plugins/infrastructure/sqlite/plugin-state.service';
import { PluginUpgradeRunner } from 'src/features/plugins/infrastructure/sqlite/plugin-upgrade.runner';
import { knowledgeManifest, knowledgePluginMeta } from '../../../shared/definitions/pluginMeta';
import { knowledgePluginMigrations } from '../../database';
import { registerKnowledgeToolRuntime } from '../runtime/knowledgeToolRuntime';
import { FileSotRepository } from '../../infrastructure/sotRepository';
import { createKnowledgeBase } from '../../domain/knowledgeBase';
import { createDocument } from '../../domain/document';
import { BlockType } from '../../domain/block';
import { attachCitationRefAllocator, attachCitationSequence } from 'src/domains/citation';
import { createCitationRefAllocatorFixture } from 'src/domains/citation/testkit/citationRefAllocatorFixture';
import { resolveEvidenceFromBundles } from 'src/domains/evidence';
import { createTempWorkspaceFixture } from 'src/app-hosts/linnya/testkit/tool-fixtures/tempWorkspace';
import type { ToolContext } from 'src/tools/types';
import { AssembleDocumentsTool } from '../assemble/AssembleDocumentsTool';
import { KnowledgeSearchTool } from '../search/KnowledgeSearchTool';
import { SearchInKnowledgeBaseTool } from '../search/SearchInKnowledgeBaseTool';
import { KnowledgeReadTool } from '../reader/KnowledgeReadTool';
import { ListKnowledgeBaseTool } from '../reader/ListKnowledgeBaseTool';

async function createFixture() {
  const workspace = await createTempWorkspaceFixture('knowledge-materialization-scope-');
  const database = new DatabaseService(path.join(workspace.root, 'workspace.sqlite'));
  database.initialize();
  const db = database.getDb();
  new PluginStateService(db).ensureBuiltinInstalled([knowledgePluginMeta]);
  expect(new PluginUpgradeRunner(db, { appVersion: '0.2.1' }).run({
    pluginId: 'knowledge', targetVersion: knowledgePluginMeta.version,
    ownedTables: knowledgeManifest.ownedTables, migrations: knowledgePluginMigrations,
  }).status).toBe('upgraded');
  const metadata = new BetterSqliteMetadataRepository(db);
  const sot = new FileSotRepository(path.join(workspace.root, 'sot'));
  const graph = new GraphSearchService(new BetterSqliteKnowledgeGraphRepository(db));
  const unused = async (): Promise<never> => { throw new Error('Scope reads must not call an unrelated capability'); };
  // 工具窄读取使用真实SQLite/SoT/图谱；不装配与此路径无关的摄入队列或模型。
  const service: KnowledgeBaseService = {
    hasActiveTasks: () => false, stopTasks: unused, rebuildIndex: unused, getIndexRebuildStatus: () => null,
    getDocumentById: id => metadata.getDocumentById(id),
    getRawSoTDocument: id => sot.get(id),
    getGraphAugmentationsForEvidenceBlocks: (refs, options) =>
      graph.getAugmentationsForEvidenceBlocks(refs, options),
    createKnowledgeBase: unused,
    getAllKnowledgeBases: unused,
    getOrCreateDefaultKnowledgeBase: unused,
    addDocument: unused,
    getDocumentsInKnowledgeBase: unused,
    getTasksStatus: unused,
    continueFailedPdfPages: unused,
    deleteKnowledgeBase: unused,
    updateKnowledgeBaseSettings: unused,
    search: unused,
    searchKnowledgeBase: unused,
    searchInDocument: unused,
    searchRawResults: unused,
    searchForAgent: unused,
    searchForAgentAcrossKnowledgeBases: unused,
    getSoTDocumentForAgent: unused,
    getSoTTableForAgent: unused,
    getDocumentContent: unused,
  };
  for (const id of ['a', 'b']) {
    db.prepare('INSERT INTO projects(id, name, created_at, updated_at) VALUES (?, ?, 1, 1)').run(id, id);
  }
  for (const kb of ['a', 'b', 'default']) {
    if (kb !== 'default') await metadata.createKnowledgeBase(createKnowledgeBase(kb, kb, '合成验收资料'));
    await metadata.addDocument(createDocument(`doc-${kb}`, kb, `${kb}.md`, 20));
    await sot.save(`doc-${kb}`, {
      doc_id: `doc-${kb}`, doc_title: kb, metadata: {},
      content_blocks: { block: { block_type: BlockType.PARAGRAPH, text: `${kb} 的独有原文` } },
      structure: { root: ['block'] },
    });
  }
  for (const id of ['a', 'b']) {
    db.prepare('INSERT INTO project_knowledge_base_links(project_id,kb_id,created_at,updated_at) VALUES (?,?,1,1)').run(id, id);
  }
  const readSoT = vi.spyOn(sot, 'get');
  let activeTools = 0;
  const unregister = registerKnowledgeToolRuntime({
    service,
    listProjectKnowledgeBaseIds: projectId => db.prepare<[string], { kb_id: string }>(
      'SELECT kb_id FROM project_knowledge_base_links WHERE project_id = ? ORDER BY created_at ASC',
    ).all(projectId).map(row => row.kb_id),
    enterTool: () => { activeTools++; return () => { activeTools--; }; },
  });
  const allocator = createCitationRefAllocatorFixture();
  const allocate = vi.spyOn(allocator, 'allocate');
  function context(projectId: string | undefined = 'a'): ToolContext {
    const result: ToolContext = {
      conversationId: 'scope-conversation', turnId: 'scope-turn', workspaceProjectId: projectId,
      research: { instanceId: 'scope-instance' },
      parentToolCallId: ToolCallIdSchema.parse('scope-tool-call'),
      createSubRunTracePublisher: () => ({ publish: () => {} }),
    };
    attachCitationSequence(result, { offset: 0 });
    attachCitationRefAllocator(result, allocator);
    return result;
  }
  return {
    context, readSoT, allocate, activeTools: () => activeTools, unregister,
    unlink: () => db.prepare('DELETE FROM project_knowledge_base_links WHERE project_id = ?').run('a'),
    async cleanup() { unregister(); vi.restoreAllMocks(); database.close(); await workspace.cleanup(); },
  };
}

const selection = (id: string) => ({ query: '资料', selected_blocks: [{ doc_id: `doc-${id}`, block_id: 'block' }] });

// 子运行端口只替代模型选择；项目SQL、元数据/SoT、组装、deep格式化和Evidence均为真实实现。
function connectChild(context: ToolContext, output: () => Promise<string>) {
  const invoke = vi.fn(async () => ({
    success: true, subrunId: 'scope-child', events: [], stepCount: 1,
    judgeToolOutput: await output(),
  }));
  context.registeredChildRunInvoker = { invoke };
  return invoke;
}

function forgedSelection(id: string): string {
  return JSON.stringify(AssembleDocumentsToolOutputSchema.parse({
    data: { query: '资料', kept: [{ doc_id: `doc-${id}`, block_id: 'block', snippet: '旧快照', doc_name: `${id}.md` }],
      dropped: [], stats: { total_input: 1, kept_count: 1, dropped_count: 0 } },
    observation: '组装完成', control: { terminateRun: true, reason: 'assemble_documents: completed' },
  }));
}

describe('Knowledge materialization project scope', () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>;
  const assemble = new AssembleDocumentsTool();
  beforeEach(async () => {
    fixture = await createFixture();
  });
  afterEach(async () => {
    try { expect(fixture?.activeTools()).toBe(0); } finally { await fixture?.cleanup(); }
  });

  it('assemble_documents 应保持原状：返回 control.terminateRun=true', async () => {
    const result = AssembleDocumentsToolOutputSchema.parse(JSON.parse(await assemble.run({ query: 'q', selected_blocks: [] }, fixture.context())));
    expect(result.control?.terminateRun).toBe(true);
    expect(fixture.activeTools()).toBe(0);
  });

  it('同项目组装保持正文和收尾合同，无绑定项目仍只可读default', async () => {
    const result = AssembleDocumentsToolOutputSchema.parse(JSON.parse(await assemble.run(selection('a'), fixture.context())));
    expect(result.data.kept[0].snippet).toBe('a 的独有原文');
    expect(result.control?.terminateRun).toBe(true);
    fixture.unlink();
    const fallback = AssembleDocumentsToolOutputSchema.parse(JSON.parse(await assemble.run(selection('default'), fixture.context())));
    expect(fallback.data.kept[0].snippet).toBe('default 的独有原文');
  });

  it.each(['foreign', 'unlinked', 'no-project'] as const)('组装%s在任何SoT读取前拒绝', async scenario => {
    const context = fixture.context();
    if (scenario === 'unlinked') fixture.unlink();
    if (scenario === 'no-project') delete context.workspaceProjectId;
    await expect(assemble.run(selection(scenario === 'foreign' ? 'b' : 'a'), context)).rejects.toThrow(/项目/);
    expect(fixture.readSoT).not.toHaveBeenCalled();
  });

  it('混合批次先核对全部归属，不能先读取允许的第一份再发现越界', async () => {
    await expect(assemble.run({ query: '资料', selected_blocks: [
      { doc_id: 'doc-a', block_id: 'block' }, { doc_id: 'doc-b', block_id: 'block' },
    ] }, fixture.context())).rejects.toThrow(/项目/);
    expect(fixture.readSoT).not.toHaveBeenCalled();
  });

  it('深搜经真实组装/阅读格式化并捕获相同canonical引用', async () => {
    const context = fixture.context();
    connectChild(context, () => assemble.run(selection('a'), context));
    const result = KnowledgeSearchResultSchema.parse(JSON.parse(await new KnowledgeSearchTool().run({ query: '资料', deep_search: true }, context)));
    expect(result.data.search_strategy).toBe('deep');
    expect(result.observation).toContain('a 的独有原文');
    const ref = result.data.citations.citations[0].ref;
    fixture.unregister();
    const evidence = await resolveEvidenceFromBundles({ conversationId: 'scope-conversation', instanceId: 'scope-instance', refs: [ref], max_units: 1000, max_chars: 1000 });
    expect(evidence.resolved[ref]).toMatchObject({ doc_id: 'doc-a', text: 'a 的独有原文' });
  });

  it.each([KnowledgeSearchTool, SearchInKnowledgeBaseTool])('两种检索入口都在搜索前拒绝其他项目文档：%s', async Tool => {
    await expect(new Tool().run({ query: '资料', doc_id: 'doc-b' }, fixture.context())).rejects.toThrow(/项目/);
    expect(fixture.readSoT).not.toHaveBeenCalled();
  });

  it('子运行取消后释放活动归属，不降级搜索或继续物化', async () => {
    const controller = new AbortController();
    const context = fixture.context();
    context.abortSignal = controller.signal;
    let entered: () => void = () => {};
    const childStarted = new Promise<void>(resolve => { entered = resolve; });
    connectChild(context, async () => {
      entered();
      await new Promise<void>(resolve => controller.signal.addEventListener('abort', () => resolve(), { once: true }));
      return forgedSelection('a');
    });
    const result = new KnowledgeSearchTool().run({ query: '资料', deep_search: true }, context);
    await childStarted;
    expect(fixture.activeTools()).toBe(1);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(fixture.readSoT).not.toHaveBeenCalled();
    expect(fixture.allocate).not.toHaveBeenCalled();
  });

  it('停用撤销后五个旧工具实例均拒绝新调用', async () => {
    fixture.unregister();
    for (const Tool of [KnowledgeSearchTool, SearchInKnowledgeBaseTool, KnowledgeReadTool, ListKnowledgeBaseTool, AssembleDocumentsTool]) {
      await expect(new Tool().run({}, fixture.context())).rejects.toThrow('知识库插件未启用');
    }
    expect(fixture.readSoT).not.toHaveBeenCalled();
  });

  it('父深搜再次核对judge返回的范围，不能靠其他项目的旧结果物化原文', async () => {
    const context = fixture.context();
    connectChild(context, async () => forgedSelection('b'));
    await expect(new KnowledgeSearchTool().run({ query: '资料', deep_search: true }, context)).rejects.toThrow(/项目/);
    expect(fixture.readSoT).not.toHaveBeenCalled();
    expect(fixture.allocate).not.toHaveBeenCalled();
  });

  it('子运行完成前解绑，父深搜不得继续读取或登记来源', async () => {
    const context = fixture.context();
    connectChild(context, async () => {
      const output = await assemble.run(selection('a'), context);
      fixture.unlink();
      fixture.readSoT.mockClear();
      return output;
    });
    await expect(new KnowledgeSearchTool().run({ query: '资料', deep_search: true }, context)).rejects.toThrow(/项目/);
    expect(fixture.readSoT).not.toHaveBeenCalled();
    expect(fixture.allocate).not.toHaveBeenCalled();
  });

  it.each(['no-project', 'foreign-document'] as const)('深搜%s在启动子运行前拒绝', async scenario => {
    const context = fixture.context();
    if (scenario === 'no-project') delete context.workspaceProjectId;
    const invoke = connectChild(context, async () => forgedSelection('b'));
    await expect(new KnowledgeSearchTool().run({ query: '资料', deep_search: true,
      ...(scenario === 'foreign-document' ? { doc_id: 'doc-b' } : {}),
    }, context)).rejects.toThrow(/项目/);
    expect(invoke).not.toHaveBeenCalled();
    expect(fixture.readSoT).not.toHaveBeenCalled();
    expect(fixture.allocate).not.toHaveBeenCalled();
  });
});
