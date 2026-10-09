import { describe, expect, it, vi } from 'vitest';
import {
  ResearchRunStructuredResultSchema,
  SubmitResearchDocumentToolOutputSchema,
  WebSearchResultSchema,
  WorkspaceReadFileResultSchema,
} from '@app/schemas';
import {
  RunIdSchema,
  ToolCallIdSchema,
  createToolOutputEvent,
  routeRuntimeEvent,
} from '@linnlabs/linnkit/contracts';
import { graph } from '@linnlabs/linnkit/runtime-kernel';
import type { ScriptedLlmTurn } from '@linnlabs/linnkit/testkit';
import * as markdown from 'src/domains/markdown';
import type { ToolContext } from 'src/tools/types';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { toolRegistry } from '../../tools/toolRegistry';
import { SqliteResearchStageReceiptStore } from '../../persistence/research-stage-receipts';
import { createWorkspaceResearchDocumentPort } from '../../research-documents';
import {
  conversationId,
  open,
  close,
  turns,
  seed,
  request,
  facts,
  identity,
  children,
  continueRoot,
  assertDelivered,
} from '../__test-helpers__/researchFlowFixture';

const badSubmission: ScriptedLlmTurn = {
  toolCalls: [
    {
      id: 'invalid-submit',
      name: 'submit_research_document',
      argumentsJson: JSON.stringify({
        content: '# Investigation\n\nMalformed source [@ViuwFk；DOT HS 813 661].',
      }),
    },
  ],
};

describe('Research submission in the producing child Graph and SQLite transaction', () => {
  it('拒绝空白稿，合法正文的首行缩进和尾部空白完整交给正式编译', async () => {
    const content = '    const baseline = 100;\n\nTrailing paragraph.  \n\n';
    const submissions = turns(6);
    const firstCall = submissions[0]?.toolCalls?.[0];
    if (!firstCall) throw new Error('Missing submission fixture');
    firstCall.argumentsJson = JSON.stringify({ content });
    const fixture = await open([
      {
        toolCalls: [
          {
            id: 'blank-submit',
            name: 'submit_research_document',
            argumentsJson: JSON.stringify({ content: ' \t\n' }),
          },
        ],
      },
      ...submissions,
    ]);
    const projectId = await seed(fixture);
    const build = vi.spyOn(markdown, 'buildMarkdownDocumentFromText');
    await fixture.flow.next(request(projectId), () => {});
    const owner = await identity(fixture, projectId);
    expect(build.mock.calls[0]?.[0].markdown).toBe(content);
    expect(build).toHaveBeenCalledTimes(6);
    const saved = new SqliteResearchStageReceiptStore(fixture.db)
      .list(owner)
      .find(item => item.stage === 'investigation')?.artifact;
    if (!saved) throw new Error('Missing investigation');
    const document = await createWorkspaceResearchDocumentPort({
      db: fixture.db,
      eventStore: fixture.eventStore,
    }).read({ projectId, inode: saved.inode });
    expect(document.text).toContain('const baseline = 100;');
    expect(document.text).toContain('Trailing paragraph.');
    const events = await facts(fixture);
    expect(
      events.find(event => event.type === 'tool_output' && event.tool_call_id === 'blank-submit')
    ).toMatchObject({ status: 'error' });
    expect(
      events.find(event => event.type === 'tool_output' && event.tool_name === 'research_run')
    ).toMatchObject({ status: 'success', data: { status: 'delivered' } });
    expect(new WorkspaceService(fixture.db).getChildNodes(null, projectId)).toHaveLength(7);
    fixture.ai.assertAllTurnsConsumed();
  });

  it('正式 read_file 在当前 child 绑定的引用可直接提交，工具批次 producer facts 先于保存可见', async () => {
    const submissions = turns(6);
    const firstCall = submissions[0]?.toolCalls?.[0];
    if (!firstCall) throw new Error('Missing submission fixture');
    const fixture = await open([
      {
        toolCalls: [
          {
            id: 'read-cited-source',
            name: 'read_file',
            argumentsJson: JSON.stringify({ locator: 'workspace:/cited-source.md' }),
          },
        ],
      },
      ...submissions,
    ]);
    const projectId = await seed(fixture);
    const seedSession = await fixture.eventStore.openRunSession(
      'material-seed',
      'material-seed-run'
    );
    const source = WebSearchResultSchema.parse({
      data: {
        query: 'fixture',
        resultCount: 1,
        citations: {
          query: 'fixture',
          searchMode: 'web',
          citations: [
            {
              ref: 'Abc234',
              index: 1,
              sourceType: 'web',
              url: 'https://example.com/source',
              docTitle: 'Source',
              snippet: 'Baseline is 100.',
            },
          ],
        },
        evidence_store: { bundle_id: '0123456789abcdef' },
        cacheStatus: 'miss',
      },
      observation: 'Synthetic source acquisition in seed run',
    });
    await fixture.eventStore.appendEventToRun(
      seedSession,
      routeRuntimeEvent(
        createToolOutputEvent(
          'seed-citation',
          'material-seed',
          'seed-turn',
          'web_search',
          'seed-web-call',
          { status: 'success', data: source.data, observation: source.observation }
        ),
        {
          run_id: RunIdSchema.parse('material-seed-run'),
          lane: 'foreground',
          visibility: 'conversation',
        }
      )
    );
    const documents = createWorkspaceResearchDocumentPort({
      db: fixture.db,
      eventStore: fixture.eventStore,
    });
    await documents.save({
      projectId,
      conversationId: 'material-seed',
      sourceRunId: 'material-seed-run',
      path: 'workspace:/cited-source.md',
      text: '# Source\n\nBaseline is 100 [@Abc234].',
      receipt: { prepare() {}, commit() {} },
    });
    const reader = toolRegistry.getTool('read_file');
    if (!reader) throw new Error('Missing reader');
    const read = reader.run.bind(reader);
    let admittedRef: string | undefined;
    vi.spyOn(reader, 'run').mockImplementation(async (args, context) => {
      const output = await read(args, context);
      const parsed = WorkspaceReadFileResultSchema.parse(JSON.parse(output));
      if (parsed.data.source_kind !== 'workspace_vfs') throw new Error('Expected Workspace source');
      admittedRef = parsed.data.citations?.citations[0]?.ref;
      if (!admittedRef) throw new Error('Missing current child citation');
      firstCall.argumentsJson = JSON.stringify({
        content: `# Investigation\n\nThe change alone does not establish its cause. Source [@${admittedRef}].`,
      });
      return output;
    });
    await fixture.flow.next(request(projectId), () => {});
    const owner = await identity(fixture, projectId);
    const investigation = new SqliteResearchStageReceiptStore(fixture.db)
      .list(owner)
      .find(item => item.stage === 'investigation')?.artifact;
    if (!investigation) throw new Error('Missing submitted investigation');
    expect(admittedRef).not.toBe('Abc234');
    expect((await documents.read({ projectId, inode: investigation.inode })).text).toContain(
      `[@${admittedRef}]`
    );
    expect(await children(fixture, owner)).toHaveLength(6);
    const events = await facts(fixture);
    expect(
      events.find(event => event.type === 'tool_output' && event.tool_name === 'research_run')
    ).toMatchObject({ status: 'success', data: { status: 'delivered' } });
    fixture.ai.assertAllTurnsConsumed();
  });

  it('非法引用反馈给同一 child，修正提交后六阶段才交付；未提交不产生文档', async () => {
    const successful = turns(6);
    const first = successful[0];
    if (!first) throw new Error('Missing scripted submission');
    const originalAssertion = first.assertCall;
    first.assertCall = call => {
      originalAssertion?.(call);
      expect(JSON.stringify(call.messages)).toContain('引用格式不合法');
      expect(JSON.stringify(call.messages)).toContain('invalid-submit');
    };
    const fixture = await open([badSubmission, ...successful]);
    const projectId = await seed(fixture);
    await fixture.flow.next(request(projectId), () => {});
    const owner = await identity(fixture, projectId);
    await assertDelivered(fixture, owner);
    const events = await facts(fixture);
    const failed = events.find(
      event => event.type === 'tool_output' && event.tool_call_id === 'invalid-submit'
    );
    expect(failed).toMatchObject({ status: 'error' });
    const firstSuccess = events.find(
      event =>
        event.type === 'tool_output' &&
        event.tool_name === 'submit_research_document' &&
        event.status === 'success'
    );
    expect(firstSuccess?.run_id).toBe(failed?.run_id);
    const entries = new SqliteResearchStageReceiptStore(fixture.db).list(owner);
    expect(entries.filter(item => item.artifact)).toHaveLength(6);
    expect(fixture.ai.getCalls()).toHaveLength(7);
  });

  it('正文与提交结果已原子提交但 ToolNode 未记终态时，恢复同一 child 且不再写入', async () => {
    const fixture = await open(turns(1));
    const projectId = await seed(fixture);
    const tool = toolRegistry.getTool('submit_research_document');
    if (!tool) throw new Error('Missing submission tool');
    const original = tool.run.bind(tool);
    const interception = vi.spyOn(tool, 'run').mockImplementation(async (args, context) => {
      const result = await original(args, context);
      expect(
        SubmitResearchDocumentToolOutputSchema.parse(JSON.parse(result)).control.terminateRun
      ).toBe(true);
      throw new graph.RunRecoveryBlockedError(
        'Simulated loss after atomic submission before ToolNode output'
      );
    });
    await fixture.flow.next(request(projectId), () => {});
    const owner = await identity(fixture, projectId);
    const started = await children(fixture, owner);
    expect(started).toHaveLength(1);
    const child = started[0];
    if (!child) throw new Error('Missing child');
    expect(child.status).toBe('paused');
    const committed = new SqliteResearchStageReceiptStore(fixture.db).list(owner)[0]?.artifact;
    expect(committed).toBeDefined();
    expect(
      fixture.runtime.toolResults?.read(child.runId, 'submit-0', 'submit_research_document')
    ).toMatchObject({ atomic_owner: 1 });
    const durableResult = fixture.runtime.toolResults?.read(
      child.runId,
      'submit-0',
      'submit_research_document'
    )?.result;
    if (!durableResult) throw new Error('Missing atomic tool receipt');
    expect(SubmitResearchDocumentToolOutputSchema.parse(JSON.parse(durableResult)).data.inode).toBe(
      committed?.inode
    );
    expect(
      (await facts(fixture)).filter(
        event => event.type === 'tool_output' && event.tool_name === 'submit_research_document'
      )
    ).toHaveLength(0);
    interception.mockRestore();
    await close(fixture);
    const resumed = await open(turns(5));
    const resumedTool = toolRegistry.getTool('submit_research_document');
    if (!resumedTool) throw new Error('Missing resumed submission tool');
    const writes = vi.spyOn(resumedTool, 'run');
    await continueRoot(resumed);
    await assertDelivered(resumed, owner);
    expect(writes).toHaveBeenCalledTimes(5);
    expect(
      new SqliteResearchStageReceiptStore(resumed.db)
        .list(owner)
        .find(item => item.stage === 'investigation')?.artifact
    ).toEqual(committed);
    expect(
      (await facts(resumed)).filter(
        event =>
          event.type === 'tool_output' &&
          event.tool_name === 'submit_research_document' &&
          event.run_id === child.runId
      )
    ).toHaveLength(1);
  });

  it('异步 Markdown 编译期间取消，正文、阶段绑定和成功 tool receipt 一起不提交', async () => {
    const fixture = await open(turns(1));
    const projectId = await seed(fixture);
    let reached!: () => void;
    let release!: () => void;
    const compiling = new Promise<void>(resolve => {
      reached = resolve;
    });
    const continueCompile = new Promise<void>(resolve => {
      release = resolve;
    });
    const original = markdown.buildMarkdownDocumentFromText;
    vi.spyOn(markdown, 'buildMarkdownDocumentFromText').mockImplementation(async args => {
      reached();
      await continueCompile;
      return original(args);
    });
    const pending = fixture.flow.next(request(projectId), () => {});
    await compiling;
    const owner = await identity(fixture, projectId);
    const started = await children(fixture, owner);
    expect(started).toHaveLength(1);
    const child = started[0];
    if (!child) throw new Error('Missing cancelling child');
    expect(
      fixture.runtime.toolResults?.read(child.runId, 'submit-0', 'submit_research_document')
    ).toMatchObject({ atomic_owner: 1, result: null });
    const cancellation = fixture.flow.cancelRun(
      owner.parentRunId,
      conversationId,
      'cancel during compile'
    );
    release();
    await cancellation;
    await pending;
    expect(
      new SqliteResearchStageReceiptStore(fixture.db).list(owner).filter(item => item.artifact)
    ).toHaveLength(0);
    expect(new WorkspaceService(fixture.db).getChildNodes(null, projectId)).toHaveLength(1);
    // 根终态会由正式恢复 owner 释放全树 receipt；不能把清理后的 absence 误报为未 prepare。
    expect(
      fixture.runtime.toolResults?.read(child.runId, 'submit-0', 'submit_research_document')
    ).toBeUndefined();
    expect(
      (await facts(fixture)).filter(
        event =>
          event.type === 'tool_output' &&
          event.tool_name === 'submit_research_document' &&
          event.status === 'success'
      )
    ).toHaveLength(0);
    fixture.ai.assertAllTurnsConsumed();
  });

  it('修正错误期间输入变更直接停止旧 child，不把版本失效当正文错误重试', async () => {
    const corrected = turns(1);
    const next = corrected[0];
    if (!next) throw new Error('Missing correction');
    const fixture = await open([badSubmission, ...corrected]);
    const projectId = await seed(fixture);
    const source = await createWorkspaceResearchDocumentPort({
      db: fixture.db,
      eventStore: fixture.eventStore,
    }).read({ projectId, locator: 'workspace:/source.md' });
    next.assertCall = () => {
      const store = new markdown.MarkdownDocumentService(fixture.db);
      const id = source.inode.slice('workspace:'.length);
      const blockId = store.getDocument(id).content?.[0]?.attrs?.id;
      if (typeof blockId !== 'string') throw new Error('Missing source block');
      store.setPendingRevision(id, blockId, 'User changed the input during correction.', 'user');
    };
    await fixture.flow.next(request(projectId), () => {});
    const owner = await identity(fixture, projectId);
    const output = (await facts(fixture)).find(
      event => event.type === 'tool_output' && event.tool_name === 'research_run'
    );
    if (!output || output.type !== 'tool_output')
      throw new Error('Missing input invalidation result');
    expect(
      ResearchRunStructuredResultSchema.parse({
        data: output.data,
        observation: output.observation,
      }).data
    ).toMatchObject({
      status: 'inputs_changed',
      artifacts: [],
      changed_paths: ['workspace:/source.md'],
    });
    expect(await children(fixture, owner)).toHaveLength(1);
    expect(new WorkspaceService(fixture.db).getChildNodes(null, projectId)).toHaveLength(1);
    fixture.ai.assertAllTurnsConsumed();
  });

  it('父模型、同伴及嵌套 worker 不得冒用 stage 能力，已提交阶段拒绝另一 call 覆盖', async () => {
    const fixture = await open(turns(6));
    const projectId = await seed(fixture);
    const tool = toolRegistry.getTool('submit_research_document');
    if (!tool) throw new Error('Missing submission tool');
    await expect(tool.run({ content: 'Forged root document' }, {})).rejects.toMatchObject({
      code: 'RESEARCH_SUBMISSION_SCOPE_REQUIRED',
    });
    const original = tool.run.bind(tool);
    let checked = false;
    vi.spyOn(tool, 'run').mockImplementation(async (args, context) => {
      if (checked) return original(args, context);
      checked = true;
      const caller: ToolContext = context;
      const submit = caller.researchDocumentSubmission;
      if (!submit) throw new Error('Missing stage capability');
      for (const forgedRun of ['sibling-research-child', 'nested-deep-web-child']) {
        await expect(
          submit('Forged document', { ...context, runId: RunIdSchema.parse(forgedRun) })
        ).rejects.toMatchObject({ code: 'RESEARCH_SUBMISSION_SCOPE_REQUIRED' });
      }
      const result = await original(args, context);
      await expect(
        submit('Different body must not overwrite', {
          ...context,
          parentToolCallId: ToolCallIdSchema.parse('another-submit-call'),
        })
      ).rejects.toThrow('already submitted');
      return result;
    });
    await fixture.flow.next(request(projectId), () => {});
    await assertDelivered(fixture, await identity(fixture, projectId));
    expect(checked).toBe(true);
  });
});
