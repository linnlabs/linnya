import { createProjectLifecycle } from 'src/domains/projects';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createToolOutputEvent, type RuntimeEvent } from '@linnlabs/linnkit/contracts';
import {
  WorkspaceEditFileResultSchema,
  WorkspaceReadFileResultSchema,
  WorkspaceWriteFileResultSchema,
} from '@app/schemas';
import { DatabaseService } from 'src/electron-main/services/database';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import {
  MarkdownDocumentService, PendingRevisionApplyService, planMarkdownBlocks,
  buildMarkdownPendingCitationMetadata, collectMarkdownLinkHrefs,
} from 'src/domains/markdown';
import {
  admitDocumentCitations, allocateCitationRefs, createCitationRefAllocator,
  attachCitationSequence, attachCitationRefAllocator, attachCitationSourceResolver,
  type CitationSource, type CitationSourceAnchor,
} from 'src/domains/citation';
import { SqliteCitationRefClaimStore } from 'src/app-hosts/linnya/adapters/persistence/citation-ref-claims/sqliteCitationRefClaimStore';
import { SQLiteEventStore } from 'src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation';
import { createCitationSourceResolver } from 'src/app-hosts/linnya/adapters/tools/citation-source-resolution';
import type { ResolveEvidenceResult } from 'src/domains/evidence';
import type { ToolContext } from 'src/tools/types';
import { ReadFileTool } from '../read_file/ReadFileTool';
import { WriteFileTool } from '../write_file/WriteFileTool';
import { EditFileTool } from './EditFileTool';

// 这两个公开合成 URL 的初始候选真实碰撞；测试不得注入假的 allocator 或篡改 claim。
const targetUrl = 'https://example.test/article?id=355289';
const otherUrl = 'https://example.test/article?id=100759';
const reader = new ReadFileTool();
const writer = new WriteFileTool();
const editor = new EditFileTool();
type FixtureMode = 'same' | 'legacy' | 'collision-current' | 'collision-original' | 'knowledge';

function emptyEvidence(refs: readonly string[]): ResolveEvidenceResult {
  return {
    resolved: {}, missing_refs: [...refs], incomplete_refs: [], scanned_bundle_count: 0,
    scanned_bundle_files: [], hit_sources: {}, conflicts: [],
  };
}

async function createFixture(mode: FixtureMode = 'legacy', repeated = false) {
  const database = new DatabaseService(':memory:');
  database.initialize();
  const db = database.getDb();
  const workspace = new WorkspaceService(db);
  const documents = new MarkdownDocumentService(db);
  const projectId = createProjectLifecycle(db).create({ name: 'Citation alias lifecycle' });
  const events = new SQLiteEventStore(db);
  await events.ensureConversation('original', [], projectId, 'agent');
  await events.ensureConversation('current', [], projectId, 'agent');
  const claimStore = new SqliteCitationRefClaimStore(db);
  const anchor: CitationSourceAnchor = mode === 'knowledge'
    ? { sourceType: 'knowledge_base', docId: 'knowledge-document', blockId: 'knowledge-block' }
    : { sourceType: 'web', url: targetUrl };
  const otherAnchor: CitationSourceAnchor = { sourceType: 'web', url: otherUrl };
  const allocate = (conversationId: string, sourceAnchor: CitationSourceAnchor): string => {
    const ref = allocateCitationRefs({ conversationId, anchors: [sourceAnchor], claimStore })[0];
    if (!ref) throw new Error('Expected allocated source ref');
    return ref;
  };
  const context = (conversationId: string): ToolContext => {
    const result: ToolContext = {
      databaseService: database, workspaceService: workspace, workspaceProjectId: projectId,
      conversationId,
    };
    attachCitationRefAllocator(result, createCitationRefAllocator({ conversationId, claimStore }));
    attachCitationSequence(result, { offset: 0 });
    return result;
  };
  const original = context('original');
  const current = context('current');
  if (mode === 'collision-original') allocate('original', otherAnchor);
  const allocated = allocate('original', anchor);
  const persistedRef = mode === 'legacy' || mode === 'knowledge' ? 'Abc234' : allocated;
  const source: CitationSource = anchor.sourceType === 'web'
    ? {
      ...anchor, ref: persistedRef, title: 'Target article', snippet: 'Target passage',
      authors: ['Alice', 'Bob', 'Carol'], containerTitle: 'Target Journal', publishedAt: '2026-01-02',
    }
    : {
      ...anchor, ref: persistedRef, title: 'Target knowledge', snippet: 'Target block',
      kbId: 'knowledge-base',
    };
  const originalBody = `主结论 [@${persistedRef}]。` +
    (repeated ? `\n\n另一个保留论点 [@${persistedRef}]。` : '') + '\n\n独立尾段。';
  async function seed(locator: string, content: string, snapshot: CitationSource) {
    // 只为合成原文档提供来源；所有被测迁移与编辑均从正式 read_file 事件经过 Host resolver。
    attachCitationSourceResolver(original, {
      resolveSources: async refs => refs.includes(snapshot.ref) ? [snapshot] : [],
      resolveSourcesByUrl: async urls => snapshot.sourceType === 'web' && urls.includes(snapshot.url)
        ? [snapshot] : [],
    });
    return WorkspaceWriteFileResultSchema.parse(JSON.parse(await writer.run({ locator, content }, original)));
  }
  const created = await seed('workspace:/original.md', originalBody, source);
  const documentId = created.data.documentId;
  const history: RuntimeEvent[] = [];
  const evidenceCalls: string[][] = [];
  function bindHistory() {
    attachCitationSourceResolver(current, createCitationSourceResolver({
      events: history,
      resolveEvidence: async refs => {
        evidenceCalls.push([...refs]);
        return emptyEvidence(refs);
      },
    }));
  }
  bindHistory();
  async function read(locator = 'workspace:/original.md', offset?: number, limit?: number) {
    const result = WorkspaceReadFileResultSchema.parse(JSON.parse(await reader.run({
      locator, ...(offset === undefined ? {} : { offset }), ...(limit === undefined ? {} : { limit }),
    }, current)));
    if (result.data.source_kind !== 'workspace_vfs') throw new Error('Expected VFS text');
    history.push(createToolOutputEvent(
      `read-${history.length}`, 'current', 'turn', 'read_file', `call-${history.length}`,
      { status: 'success', data: result.data, observation: result.observation },
    ));
    bindHistory();
    return { ...result, data: result.data };
  }
  let otherRef: string | undefined;
  if (mode === 'collision-current') {
    otherRef = allocate('current', otherAnchor);
    await seed('workspace:/other.md', `另一来源 [@${otherRef}]。`, {
      ...otherAnchor, ref: otherRef, title: 'Other article', snippet: 'Other passage',
      authors: ['Dana'], containerTitle: 'Other Journal', publishedAt: '2026-02-03',
    });
    await read('workspace:/other.md');
  }
  const state = () => ({
    version: documents.getLatestVersion(documentId),
    pending: documents.getPendingRevisions(documentId),
  });
  const stateHash = () => createHash('sha256').update(JSON.stringify(state())).digest('hex');
  const sources = (id = documentId) => admitDocumentCitations(documents.getDocument(id)).sources
    .filter(source => source.sourceType !== 'manual');
  async function edit(oldString: string, newString: string) {
    return WorkspaceEditFileResultSchema.parse(JSON.parse(await editor.run({
      locator: 'workspace:/original.md', old_string: oldString, new_string: newString,
    }, current)));
  }
  async function write(content: string, locator = 'workspace:/original.md') {
    return WorkspaceWriteFileResultSchema.parse(JSON.parse(await writer.run({ locator, content }, current)));
  }
  async function decide(decision: 'accept' | 'reject') {
    const version = documents.getLatestVersion(documentId);
    if (!version) throw new Error('Expected saved version');
    return new PendingRevisionApplyService(documents).commitEditorRevision({
      documentId, expectedVersionNumber: version.version_number,
      expectedPending: state().pending.map(({ id, revision }) => ({ id, revision })),
      baseline: documents.getDocument(documentId), decision: { mode: decision },
    });
  }
  async function proposeLegacyLink() {
    if (source.sourceType !== 'web') throw new Error('Expected Web fixture');
    const markdown = `主结论 [Target article](${source.url})。`;
    const metadata = await buildMarkdownPendingCitationMetadata(markdown, async () => [], {
      collectLinkHrefs: async text => {
        const planned = await planMarkdownBlocks(text);
        return planned.docJson ? collectMarkdownLinkHrefs(planned.docJson) : [];
      },
      resolveSourcesByUrl: async () => [source],
    });
    const blockId = documents.getDocument(documentId).content[0]?.attrs?.id;
    if (typeof blockId !== 'string') throw new Error('Expected existing block');
    // 旧正式写入链保存 URL 正文 + link hydration；不伪造会话历史或 allocator claim。
    documents.setPendingRevision(documentId, blockId, markdown, 'ai', {
      ...metadata.values().next().value, operation: 'update',
    });
  }
  async function close() {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    database.close();
  }
  return {
    read, edit, write, decide, state, stateHash, sources, close, source, evidenceCalls,
    originalBody, persistedRef, otherRef, original, current, documentId, seed, proposeLegacyLink,
  };
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;
async function withFixture(
  mode: FixtureMode,
  run: (fixture: Fixture) => Promise<void>,
  repeated = false,
): Promise<void> {
  const fixture = await createFixture(mode, repeated);
  try { await run(fixture); }
  finally { await fixture.close(); }
}

function expectTargetSource(sources: readonly { readonly sourceType: string }[], ref?: string): void {
  expect(sources).toEqual([expect.objectContaining({
    sourceType: 'web', url: targetUrl,
    authors: ['Alice', 'Bob', 'Carol'], containerTitle: 'Target Journal', publishedAt: '2026-01-02',
    ...(ref ? { ref } : {}),
  })]);
}

async function aliasOf(fixture: Fixture): Promise<string> {
  const result = await fixture.read();
  const ref = result.data.citations?.citations[0]?.ref;
  if (!ref) throw new Error('Expected current-conversation alias');
  return ref;
}

function bodyOf(read: Awaited<ReturnType<Fixture['read']>>): string {
  return read.observation.split('\n').flatMap(line => {
    const match = /^\d+ \| ?(.*)$/.exec(line);
    return match ? [match[1]] : [];
  }).join('\n');
}

describe('Workspace edits keep document sources separate from conversation aliases', () => {
  it.each([
    '```text\n[@Zzz999]\n```',
    '`[@Zzz999]`',
  ])('引用外观的代码保持代码语义：%s', async code => {
    await withFixture('collision-current', async f => {
      await f.write(`代码示例：\n\n${code}`);
      const preview = await f.read();
      expect(preview.data.citations).toBeUndefined();
      expect(preview.observation).toContain('Zzz999');
      await f.decide('accept');
      expect(f.sources()).toEqual([]);
      expect(f.evidenceCalls).toEqual([]);
    });
  });

  it('链接规范化保留批注身份、普通链接与列表间隔，代码里的 ref 不参与回投', async () => {
    await withFixture('collision-current', async f => {
      const alias = await aliasOf(f);
      const target = [
        `1. 已取得 [Target article](${targetUrl})。`,
        '2. 未取得 [Unseen](https://unseen.example.test/path)。',
        '',
        '<!-- 评审示例 `[@Zzz999]`，不是正文引用。 -->',
        '',
        `**正文 [@${alias}]**。`,
      ].join('\n');
      expect((await planMarkdownBlocks(target)).annotationComments).toHaveLength(1);
      await f.write(target);
      expect(JSON.stringify(f.state())).toContain('评审示例');
      const before = await f.read();
      expect(before.observation).toContain('1. 已取得');
      expect(bodyOf(before)).toContain('1. 已取得');
      expect(bodyOf(before)).toContain('\n2. 未取得');
      expect(before.observation).toContain('[Unseen](https://unseen.example.test/path)');
      expect(before.observation).not.toContain('annotation-draft-');
      expectTargetSource(before.data.citations?.citations ?? []);
      await f.decide('accept');
      const accepted = await f.read();
      expect(accepted.observation).toContain('评审示例');
      expect(accepted.observation).toContain('**正文');
      const state = f.stateHash();
      // canonical 批注回读再原样写回，不能替换为 planner 临时身份或生成新批注。
      await f.write(bodyOf(accepted));
      expect(f.stateHash()).toBe(state);
      expect(f.evidenceCalls).toEqual([]);
    });
  });

  it.each(['same', 'legacy', 'collision-current', 'collision-original'] as const)(
    '%s：只改引用旁的文字不替换来源，接受后仍保留完整元数据', async mode => {
      await withFixture(mode, async f => {
        const beforeRead = f.stateHash();
        const alias = await aliasOf(f);
        expect(f.stateHash()).toBe(beforeRead);
        expect(await aliasOf(f)).toBe(alias);
        if (mode === 'same') expect(alias).toBe(f.persistedRef);
        else expect(alias).not.toBe(f.persistedRef);
        if (mode === 'collision-current') expect(f.otherRef).toBe(f.persistedRef);
        await f.edit('主结论', '修订结论');
        const preview = await f.read();
        expectTargetSource(preview.data.citations?.citations ?? []);
        await f.decide('accept');
        expectTargetSource(f.sources(), f.persistedRef);
        expect(f.state().pending).toHaveLength(0);
        expect(f.evidenceCalls).toEqual([]);
      });
    },
  );

  it('知识库旧别名编辑保留 doc/block/kb 与来源快照', async () => {
    await withFixture('knowledge', async f => {
      expect(await aliasOf(f)).not.toBe(f.persistedRef);
      await f.edit('主结论', '修订结论');
      const preview = await f.read();
      expect(preview.data.citations?.citations).toEqual([expect.objectContaining({
        sourceType: 'knowledge_base', docId: 'knowledge-document', blockId: 'knowledge-block',
        kbId: 'knowledge-base', docTitle: 'Target knowledge', snippet: 'Target block',
      })]);
      await f.decide('accept');
      expect(f.sources()).toEqual([expect.objectContaining({
        ref: f.persistedRef, sourceType: 'knowledge_base', docId: 'knowledge-document',
        blockId: 'knowledge-block', kbId: 'knowledge-base', excerpts: ['Target block'],
      })]);
      expect(f.evidenceCalls).toEqual([]);
    });
  });

  it('old_string 可直接包含 read_file 的新别名，仍执行唯一精确替换', async () => {
    await withFixture('collision-current', async f => {
      const alias = await aliasOf(f);
      const edited = await f.edit(`主结论 [@${alias}]。`, `改好的论断 [@${alias}]。`);
      expect(edited.data.replaced).toBe(1);
      expect((await f.read()).observation).toContain('改好的论断');
      await f.decide('accept');
      expectTargetSource(f.sources(), f.persistedRef);
    });
  });

  it.each(['legacy', 'collision-current'] as const)(
    '%s：只改无引用段落不要求重新取得未变来源', async mode => {
      await withFixture(mode, async f => {
        await aliasOf(f);
        await f.edit('独立尾段', '修订尾段');
        expectTargetSource((await f.read()).data.citations?.citations ?? []);
        await f.decide('accept');
        expectTargetSource(f.sources(), f.persistedRef);
        expect(f.evidenceCalls).toEqual([]);
      });
    },
  );

  it('只读无引用窗口后修改该段，也保留窗口外的已有引用', async () => {
    await withFixture('same', async f => {
      const window = await f.read('workspace:/original.md', 3, 1);
      expect(window.data.citations?.citations ?? []).toEqual([]);
      await f.edit('独立尾段', '修订尾段');
      await f.decide('accept');
      expectTargetSource(f.sources(), f.persistedRef);
      expect(f.evidenceCalls).toEqual([]);
    });
  });

  it('同一来源在多段出现，改其中一段不产生引用冲突或影响其余段', async () => {
    await withFixture('collision-current', async f => {
      await aliasOf(f);
      await f.edit('主结论', '修订结论');
      const preview = await f.read();
      expect(preview.observation).toContain('另一个保留论点');
      expectTargetSource(preview.data.citations?.citations ?? []);
      await f.decide('accept');
      expectTargetSource(f.sources(), f.persistedRef);
    }, true);
  });

  it('读回原样全文写入不生成仅改变引用别名的 pending', async () => {
    await withFixture('collision-current', async f => {
      const alias = await aliasOf(f);
      const before = f.stateHash();
      await f.write(f.originalBody.split(`[@${f.persistedRef}]`).join(`[@${alias}]`));
      expect(f.state().pending).toHaveLength(0);
      expect(f.stateHash()).toBe(before);
      expectTargetSource(f.sources(), f.persistedRef);
    });
  });

  it('全文改写与另写新文档均按来源身份绑定，保留多作者刊名日期', async () => {
    await withFixture('legacy', async f => {
      const alias = await aliasOf(f);
      await f.write(`改写论断 [@${alias}]。\n\n独立尾段。`);
      expectTargetSource((await f.read()).data.citations?.citations ?? []);
      await f.decide('accept');
      expectTargetSource(f.sources(), f.persistedRef);
      const copy = await f.write(`复制论断 [@${alias}]。`, 'workspace:/copy.md');
      expectTargetSource(f.sources(copy.data.documentId));
    });
  });

  it('当前会话同名 ref 的新来源与文档旧来源可同时写入，不覆盖旧来源身份', async () => {
    await withFixture('collision-current', async f => {
      const alias = await aliasOf(f);
      if (!f.otherRef) throw new Error('Expected other source alias');
      await f.edit(`主结论 [@${alias}]。`, `主结论 [@${alias}]。新增依据 [@${f.otherRef}]。`);
      const preview = await f.read();
      expect(preview.data.citations?.citations).toEqual([
        expect.objectContaining({ url: targetUrl, authors: ['Alice', 'Bob', 'Carol'] }),
        expect.objectContaining({ url: otherUrl, authors: ['Dana'] }),
      ]);
      await f.decide('accept');
      const saved = f.sources();
      const target = saved.find(item => item.sourceType === 'web' && item.url === targetUrl);
      const added = saved.find(item => item.sourceType === 'web' && item.url === otherUrl);
      expect(target).toMatchObject({ ref: f.persistedRef, containerTitle: 'Target Journal' });
      expect(added).toMatchObject({ containerTitle: 'Other Journal', publishedAt: '2026-02-03' });
      expect(added?.ref).not.toBe(target?.ref);
      expect((await f.read()).observation).toContain(`[@${alias}]`);
    });
  });

  it('URL 链接在同一碰撞场景按稳定来源绑定，新增来源不占用文档既有 ref', async () => {
    await withFixture('collision-current', async f => {
      await aliasOf(f);
      await f.write(`主结论 [Target article](${targetUrl})。\n\n新增依据 [Other article](${otherUrl})。`);
      const preview = await f.read();
      expect(preview.data.citations?.citations).toEqual([
        expect.objectContaining({ url: targetUrl, authors: ['Alice', 'Bob', 'Carol'] }),
        expect.objectContaining({ url: otherUrl, authors: ['Dana'] }),
      ]);
      await f.decide('accept');
      const target = f.sources().find(item => item.sourceType === 'web' && item.url === targetUrl);
      const added = f.sources().find(item => item.sourceType === 'web' && item.url === otherUrl);
      expect(target).toMatchObject({ ref: f.persistedRef, containerTitle: 'Target Journal' });
      expect(added).toMatchObject({ containerTitle: 'Other Journal', publishedAt: '2026-02-03' });
      expect(added?.ref).not.toBe(target?.ref);
    });
  });

  it('归一 URL 对应多个持久来源时拒绝猜选，已有正文与来源保持不变', async () => {
    await withFixture('legacy', async f => {
      if (f.source.sourceType !== 'web') throw new Error('Expected Web fixture');
      const variantRef = 'Jkm234';
      await f.seed('workspace:/variant.md', `变体 [@${variantRef}]。`, {
        ...f.source, ref: variantRef, url: `${targetUrl}#table`, title: 'A distinct captured URL',
      });
      const variant = (await f.read('workspace:/variant.md')).data.citations?.citations[0];
      if (!variant) throw new Error('Expected captured variant source');
      const alias = await aliasOf(f);
      await f.write(`主结论 [@${alias}]。\n\n变体来源 [@${variant.ref}]。`);
      await f.decide('accept');
      const before = f.stateHash();
      await expect(f.write(`不能猜版本 [标题](${targetUrl})。`)).rejects.toThrow('对应了不同的来源锚点');
      expect(f.stateHash()).toBe(before);
    });
  });

  it('普通链接目的地址中的引用外观字面值不参与别名回投', async () => {
    await withFixture('collision-current', async f => {
      const alias = await aliasOf(f);
      const url = `https://unseen.example.test/[@${alias}]`;
      await f.write(`主结论 [@${alias}]。\n\n[普通链接](${url})。`);
      expect((await f.read()).observation).toContain(url);
      await f.decide('accept');
      const accepted = await f.read();
      expect(accepted.observation).toContain(url);
      expectTargetSource(f.sources(), f.persistedRef);
    });
  });

  it('旧 URL-only Pending 没有当前历史来源时，继续编辑仍保留已持久化完整快照', async () => {
    await withFixture('legacy', async f => {
      await f.write('普通正文。');
      await f.decide('accept');
      expect(f.sources()).toEqual([]);
      await f.proposeLegacyLink();
      expect((await f.read()).data.citations).toBeUndefined();
      await f.edit('主结论', '继续修订的结论');
      expectTargetSource((await f.read()).data.citations?.citations ?? []);
      await f.decide('accept');
      expectTargetSource(f.sources(), f.persistedRef);
      expect(f.evidenceCalls).toEqual([]);
    });
  });

  it.each(['accept', 'reject'] as const)(
    '已有 pending 可继续按当前别名编辑，并安全 %s', async decision => {
      await withFixture('legacy', async f => {
        await editor.run({
          locator: 'workspace:/original.md', old_string: '主结论', new_string: '首轮修订',
        }, f.original);
        const firstPending = f.state().pending[0];
        if (!firstPending) throw new Error('Expected first pending revision');
        const alias = await aliasOf(f);
        await f.edit(`首轮修订 [@${alias}]。`, `第二轮修订 [@${alias}]。`);
        expect(f.state().pending).toHaveLength(1);
        expect(f.state().pending[0]).toMatchObject({
          id: firstPending.id, revision: firstPending.revision + 1,
        });
        expectTargetSource((await f.read()).data.citations?.citations ?? []);
        await f.decide(decision);
        expect(f.state().pending).toHaveLength(0);
        const restored = await f.read();
        expect(restored.observation).toContain(decision === 'accept' ? '第二轮修订' : '主结论');
        expectTargetSource(f.sources(), f.persistedRef);
      });
    },
  );

  it('未知新增 ref 拒绝整个编辑，已有正文和 pending 不变', async () => {
    await withFixture('collision-current', async f => {
      const alias = await aliasOf(f);
      await f.edit('主结论', '已存在的修订');
      const before = f.stateHash();
      await expect(f.edit('独立尾段。', `新依据 [@${alias}] 与 [@Zzz999]。`))
        .rejects.toThrow('Citation sources not found');
      expect(f.stateHash()).toBe(before);
      expectTargetSource((await f.read()).data.citations?.citations ?? []);
    });
  });

  it('原引用整块待删除后写回读到的原稿，撤销删除并恢复原文档 ref', async () => {
    await withFixture('collision-current', async f => {
      const alias = await aliasOf(f);
      const before = f.stateHash();
      await f.edit(`主结论 [@${alias}]。`, '');
      expect(f.state().pending).toHaveLength(1);
      expect(f.state().pending[0]?.operation).toBe('delete');
      expect((await f.read()).data.citations?.citations ?? []).toEqual([]);
      await f.write(f.originalBody.split(`[@${f.persistedRef}]`).join(`[@${alias}]`));
      expect(f.state().pending).toHaveLength(0);
      expect(f.stateHash()).toBe(before);
      expectTargetSource(f.sources(), f.persistedRef);
      expectTargetSource((await f.read()).data.citations?.citations ?? []);
    });
  });

  it('删除唯一引用不保留空来源，也不需要猜测旧别名', async () => {
    await withFixture('legacy', async f => {
      const alias = await aliasOf(f);
      await f.edit(`主结论 [@${alias}]。`, '无引文的修订结论。');
      expect((await f.read()).data.citations?.citations ?? []).toEqual([]);
      await f.decide('accept');
      expect(f.sources()).toEqual([]);
    });
  });
});
