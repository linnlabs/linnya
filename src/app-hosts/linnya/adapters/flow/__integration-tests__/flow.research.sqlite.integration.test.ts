import { describe, expect, it, vi } from 'vitest';
import { ResearchRunStructuredResultSchema } from '@app/schemas';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import { graph } from '@linnlabs/linnkit/runtime-kernel';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { MarkdownDocumentService } from 'src/domains/markdown';
import { RegisteredChildRunInvoker } from '../../child-runs/registeredSubagentInvoker';
import { toolRegistry } from '../../tools/toolRegistry';
import { createWorkspaceResearchDocumentPort } from '../../research-documents';
import { SqliteResearchStageReceiptStore } from '../../persistence/research-stage-receipts';
import { readTail } from '../../persistence/event-store/ui-projection/sqliteUiMessagesReader';
import {
  conversationId,
  modelId,
  input,
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

describe('Production research entry through real Flow, ToolRegistry and registered children', () => {
  it('内部作者角色的直接根入口在接纳前拒绝，不消耗模型或创建 child', async () => {
    const fixture = await open([]);
    const projectId = await seed(fixture);
    const base = request(projectId, false);
    await expect(
      fixture.flow.next(
        { ...base, options: { ...base.options, promptKey: 'research_author_v1' } },
        () => {}
      )
    ).rejects.toThrow();
    expect(await facts(fixture)).toEqual([]);
    expect(
      await fixture.runtime.supervisor.findByConversation(conversationId, { includeChildren: true })
    ).toEqual([]);
    expect(fixture.ai.getCalls()).toHaveLength(0);
    expect(new WorkspaceService(fixture.db).getChildNodes(null, projectId)).toHaveLength(1);
  });

  it('真实 ToolNode 拒绝固定材料检索与伪造文档写入，六阶段正式交付且根不调用模型', async () => {
    const fixture = await open([
      {
        toolCalls: [
          {
            id: 'research-method',
            name: 'skill',
            argumentsJson: JSON.stringify({ action: 'activate', skill_name: 'deep-research' }),
          },
          {
            id: 'research-modeling',
            name: 'skill',
            argumentsJson: JSON.stringify({
              action: 'read_resource',
              skill_name: 'deep-research',
              resource_path: 'references/modeling.md',
            }),
          },
          {
            id: 'outside-search',
            name: 'web_search',
            argumentsJson: JSON.stringify({ query: 'outside material' }),
          },
          {
            id: 'supplied-source',
            name: 'read_file',
            argumentsJson: JSON.stringify({ locator: 'workspace:/source.md' }),
          },
          {
            id: 'forged-write',
            name: 'write_file',
            argumentsJson: JSON.stringify({
              locator: 'workspace:/forged.md',
              content: '# Unauthorized document',
            }),
          },
          {
            id: 'forged-edit',
            name: 'edit_file',
            argumentsJson: JSON.stringify({
              locator: 'workspace:/source.md',
              old_string: 'Baseline is 100',
              new_string: 'Baseline is 200',
            }),
          },
        ],
      },
      ...turns(6),
    ]);
    const projectId = await seed(fixture);
    const searchTool = toolRegistry.getTool('web_search');
    const writeTool = toolRegistry.getTool('write_file');
    const editTool = toolRegistry.getTool('edit_file');
    if (!searchTool || !writeTool || !editTool) throw new Error('Missing formal tool registration');
    const search = vi.spyOn(searchTool, 'run');
    const write = vi.spyOn(writeTool, 'run');
    const edit = vi.spyOn(editTool, 'run');
    const documents = createWorkspaceResearchDocumentPort({
      db: fixture.db,
      eventStore: fixture.eventStore,
    });
    const originalSource = await documents.read({ projectId, locator: 'workspace:/source.md' });
    const original = RegisteredChildRunInvoker.prototype.invoke;
    let reviewsFinished = 0;
    let releaseReviews!: () => void;
    const bothReviewsFinished = new Promise<void>(resolve => {
      releaseReviews = resolve;
    });
    const invoke = vi
      .spyOn(RegisteredChildRunInvoker.prototype, 'invoke')
      .mockImplementation(async function (this: RegisteredChildRunInvoker, call) {
        const result = await original.call(this, call);
        if (!result.runId) throw new Error('Missing completed child identity');
        expect((await fixture.runtime.runDescriptors?.load(result.runId))?.request).toMatchObject({
          modelId,
          maxSteps: 800,
          reasoning_effort: 'high',
        });
        const { runId, parentToolCallId } = call.parentToolContext;
        if (!runId || !parentToolCallId) throw new Error('Missing parent identity');
        expect(
          fixture.runtime.toolResults?.read(runId, parentToolCallId, 'research_run')
        ).toBeUndefined();
        expect((await fixture.runtime.runDescriptors?.load(runId))?.request.enableTools).toBe(
          false
        );
        const projection = readTail(fixture.db, conversationId, 100);
        if (projection.status !== 'ready') throw new Error('Missing live research projection');
        expect(
          projection.messages.find(message => message.message_type === 'tool_calls')
        ).toMatchObject({ payload: { status: 'loading' } });
        if (
          call.promptKey === 'research_argument_review_v1' ||
          call.promptKey === 'research_source_review_v1'
        ) {
          reviewsFinished += 1;
          if (reviewsFinished === 2) releaseReviews();
          // 真正并行的两份 child 均返回后才放行；串行实现会无法越过这条业务边界。
          await bothReviewsFinished;
        }
        return result;
      });
    await fixture.flow.next(request(projectId), () => {});
    const owner = await identity(fixture, projectId);
    await assertDelivered(fixture, owner);
    expect(search).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
    expect((await documents.read({ projectId, inode: originalSource.inode })).sha256).toBe(
      originalSource.sha256
    );
    const events = await facts(fixture);
    for (const callId of ['forged-write', 'forged-edit']) {
      expect(
        events.find(event => event.type === 'tool_output' && event.tool_call_id === callId)
      ).toMatchObject({ status: 'error', error_code: 'REGISTERED_CHILD_TOOL_NOT_ALLOWED' });
    }
    expect(
      events.find(event => event.type === 'tool_output' && event.tool_call_id === 'outside-search')
    ).toMatchObject({ status: 'error' });
    expect(
      JSON.stringify(
        events.find(
          event => event.type === 'tool_output' && event.tool_call_id === 'outside-search'
        )
      )
    ).toContain('RESEARCH_RETRIEVAL_NOT_ALLOWED');
    expect(
      events.find(event => event.type === 'tool_output' && event.tool_call_id === 'supplied-source')
    ).toMatchObject({ status: 'success' });
    for (const callId of ['research-method', 'research-modeling']) {
      expect(
        events.find(event => event.type === 'tool_output' && event.tool_call_id === callId)
      ).toMatchObject({ status: 'success' });
    }
    expect(reviewsFinished).toBe(2);
    expect(invoke.mock.calls).toHaveLength(6);
    expect(invoke.mock.calls.map(([call]) => call.promptKey)).toEqual([
      'research_author_v1',
      'research_investigation_review_v1',
      'research_author_v1',
      'research_argument_review_v1',
      'research_source_review_v1',
      'research_author_v1',
    ]);
    for (const [call] of invoke.mock.calls) {
      expect(call.executionPolicy).toMatchObject({ maxSteps: 800, modelId });
      expect(call.parentToolContext).toMatchObject({ researchRetrievalAllowed: false });
    }
    expect(fixture.ai.getCalls()).toHaveLength(7);
    expect(fixture.ai.getCalls().every(call => call.options.reasoning_effort === 'high')).toBe(
      true
    );
  });

  it.each(['missing_scope', 'unbound_context'] as const)(
    '接纳前拒绝 %s，不静默丢弃研究范围',
    async kind => {
      const fixture = await open([]);
      const projectId = await seed(fixture);
      const base = request(projectId, kind === 'unbound_context');
      const submitted =
        kind === 'unbound_context'
          ? { ...base, options: { ...base.options, document_fragment: 'Unbound selected source' } }
          : base;
      await expect(fixture.flow.next(submitted, () => {})).rejects.toMatchObject({
        code:
          kind === 'missing_scope' ? 'RESEARCH_SCOPE_REQUIRED' : 'RESEARCH_CONTEXT_NOT_SUPPORTED',
      });
      expect(await facts(fixture)).toEqual([]);
      expect(
        await fixture.runtime.supervisor.findByConversation(conversationId, {
          includeChildren: true,
        })
      ).toEqual([]);
      expect(new WorkspaceService(fixture.db).getChildNodes(null, projectId)).toHaveLength(1);
      fixture.ai.assertAllTurnsConsumed();
    }
  );

  it('普通根模型伪造 research_run 缺少 Host 接纳凭据，不创建 child 或研究稿件', async () => {
    const fixture = await open([
      {
        toolCalls: [
          {
            id: 'forged-research-entry',
            name: 'research_run',
            argumentsJson: JSON.stringify(input),
          },
          {
            id: 'forged-stage-submit',
            name: 'submit_research_document',
            argumentsJson: JSON.stringify({ content: 'Forged root draft' }),
          },
        ],
        assertCall(call) {
          expect(call.options.tools?.map(tool => tool.name)).not.toContain('research_run');
          expect(call.options.tools?.map(tool => tool.name)).not.toContain(
            'submit_research_document'
          );
        },
      },
      { contentChunks: ['The research workflow requires a formally admitted Host entry.'] },
    ]);
    const projectId = await seed(fixture);
    const invoke = vi.spyOn(RegisteredChildRunInvoker.prototype, 'invoke');
    const ordinaryRequest = request(projectId, false);
    await fixture.flow.next(
      { ...ordinaryRequest, options: { ...ordinaryRequest.options, promptKey: 'default' } },
      () => {}
    );
    const owner = await identity(fixture, projectId);
    expect(await children(fixture, owner)).toHaveLength(0);
    expect(invoke).not.toHaveBeenCalled();
    expect(new WorkspaceService(fixture.db).getChildNodes(null, projectId)).toHaveLength(1);
    expect(new SqliteResearchStageReceiptStore(fixture.db).list(owner)).toHaveLength(0);
    expect(
      (await facts(fixture)).find(
        event => event.type === 'tool_output' && event.tool_call_id === 'forged-research-entry'
      )
    ).toMatchObject({
      status: 'error',
      error_code: 'RESEARCH_HOST_ENTRY_REQUIRED',
    });
    expect(
      (await facts(fixture)).find(
        event => event.type === 'tool_output' && event.tool_call_id === 'forged-stage-submit'
      )
    ).toMatchObject({ status: 'error', error_code: 'RESEARCH_SUBMISSION_SCOPE_REQUIRED' });
    fixture.ai.assertAllTurnsConsumed();
  });

  it('自由终答不能代替正式提交，根按 yield 结算但不交付或接纳后继，重载保留错误', async () => {
    const fixture = await open([
      {
        contentChunks: [
          '# Investigation\n\nThe value is supported by an unbound citation [@Abc234].',
        ],
      },
    ]);
    const projectId = await seed(fixture);
    await fixture.flow.next(request(projectId), () => {});
    const owner = await identity(fixture, projectId);
    const runs = await children(fixture, owner);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('completed');
    expect(
      (await fixture.runtime.supervisor.peek(RunIdSchema.parse(owner.parentRunId)))?.status
    ).toBe('completed');
    const events = await facts(fixture);
    const outputs = events.filter(
      event => event.type === 'tool_output' && event.tool_name === 'research_run'
    );
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({
      status: 'error',
    });
    const output = outputs[0];
    if (!output || output.type !== 'tool_output') throw new Error('Missing research rejection');
    expect(
      ResearchRunStructuredResultSchema.safeParse({
        data: output.data,
        observation: output.observation,
      }).success
    ).toBe(false);
    expect(
      events.filter(event => event.type === 'final_answer' && event.run_id === owner.parentRunId)
    ).toHaveLength(0);
    const receipts = new SqliteResearchStageReceiptStore(fixture.db).list(owner);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.stage).toBe('investigation');
    expect(receipts[0]?.artifact).toBeUndefined();
    expect(
      new WorkspaceService(fixture.db).getChildNodes(null, projectId).map(node => node.name)
    ).toEqual(['source.md']);
    fixture.ai.assertAllTurnsConsumed();
    await close(fixture);
    const reloaded = await open([]);
    const projection = readTail(reloaded.db, conversationId, 100);
    if (projection.status !== 'ready') throw new Error('Missing reloaded research rejection');
    const tools = projection.messages.filter(message => message.message_type === 'tool_calls');
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      payload: {
        tool_name: 'research_run',
        status: 'error',
      },
    });
    expect(await children(reloaded, owner)).toHaveLength(1);
    expect((await reloaded.flow.getActiveForegroundRun(conversationId)).run).toBeNull();
    reloaded.ai.assertAllTurnsConsumed();
  });

  it('研究进行中编辑材料保留旧输入候选，正式结果标明输入变化且不接纳复核', async () => {
    const fixture = await open(turns(1));
    const projectId = await seed(fixture);
    const documents = createWorkspaceResearchDocumentPort({
      db: fixture.db,
      eventStore: fixture.eventStore,
    });
    const source = await documents.read({ projectId, locator: 'workspace:/source.md' });
    const original = RegisteredChildRunInvoker.prototype.invoke;
    vi.spyOn(RegisteredChildRunInvoker.prototype, 'invoke').mockImplementation(async function (
      this: RegisteredChildRunInvoker,
      call
    ) {
      const result = await original.call(this, call);
      const documentId = source.inode.slice('workspace:'.length);
      const markdown = new MarkdownDocumentService(fixture.db);
      const blockId = markdown.getDocument(documentId).content?.[0]?.attrs?.id;
      if (typeof blockId !== 'string') throw new Error('Missing material block');
      markdown.setPendingRevision(
        documentId,
        blockId,
        'The user changed the source while research was running.',
        'user'
      );
      return result;
    });
    await fixture.flow.next(request(projectId), () => {});
    const owner = await identity(fixture, projectId);
    expect(await children(fixture, owner)).toHaveLength(1);
    const output = (await facts(fixture)).find(
      event => event.type === 'tool_output' && event.tool_name === 'research_run'
    );
    if (!output || output.type !== 'tool_output') throw new Error('Missing research outcome');
    const result = ResearchRunStructuredResultSchema.parse({
      data: output.data,
      observation: output.observation,
    });
    expect(result.data).toMatchObject({
      status: 'inputs_changed',
      changed_paths: ['workspace:/source.md'],
    });
    expect(result.data.artifacts).toHaveLength(1);
    const receipt = new SqliteResearchStageReceiptStore(fixture.db).list(owner)[0];
    expect(receipt?.inputs[0]?.sha256).toBe(source.sha256);
    expect(receipt?.artifact).toBeDefined();
    expect((await documents.read({ projectId, inode: source.inode })).sha256).not.toBe(
      source.sha256
    );
    expect((await fixture.flow.getActiveForegroundRun(conversationId)).run).toBeNull();
    fixture.ai.assertAllTurnsConsumed();
  });

  it.each(['before_second_child', 'after_last_child'] as const)(
    '在 %s 中断后复用同一 child 与文档身份',
    async boundary => {
      const completed = boundary === 'before_second_child' ? 1 : 6;
      const first = await open(turns(completed));
      const projectId = await seed(first);
      const original = RegisteredChildRunInvoker.prototype.invoke;
      const interception = vi
        .spyOn(RegisteredChildRunInvoker.prototype, 'invoke')
        .mockImplementation(async function (this: RegisteredChildRunInvoker, call) {
          if (
            boundary === 'before_second_child' &&
            call.promptKey === 'research_investigation_review_v1'
          ) {
            throw new graph.RunRecoveryBlockedError(
              'Interrupted after committed investigation, before successor admission'
            );
          }
          const result = await original.call(this, call);
          if (
            boundary === 'after_last_child' &&
            call.tracePolicy?.subrunId?.endsWith('_revision')
          ) {
            throw new graph.RunRecoveryBlockedError(
              'Interrupted after final child, before its artifact and parent result'
            );
          }
          return result;
        });
      await first.flow.next(request(projectId), () => {});
      const owner = await identity(first, projectId);
      const originalChildren = await children(first, owner);
      expect(originalChildren).toHaveLength(completed);
      expect(originalChildren.every(run => run.status === 'completed')).toBe(true);
      const originalFacts = (await facts(first)).filter(event =>
        originalChildren.some(child => child.runId === event.run_id)
      );
      const originalArtifacts = new SqliteResearchStageReceiptStore(first.db)
        .list(owner)
        .filter(receipt => receipt.artifact);
      expect(originalArtifacts).toHaveLength(completed);
      expect(
        first.runtime.toolResults?.read(owner.parentRunId, owner.toolCallId, 'research_run')
      ).toBeUndefined();
      interception.mockRestore();
      await close(first);
      const resumed = await open(turns(6 - completed));
      await continueRoot(resumed);
      await assertDelivered(resumed, owner);
      expect(
        (await facts(resumed)).filter(event =>
          originalChildren.some(child => child.runId === event.run_id)
        )
      ).toEqual(originalFacts);
      const restored = new SqliteResearchStageReceiptStore(resumed.db).list(owner);
      for (const receipt of originalArtifacts)
        expect(restored.find(item => item.stage === receipt.stage)).toEqual(receipt);
    }
  );

  it('真实取消在首稿保存后阻止后继 child 接纳，重载不继续执行', async () => {
    const fixture = await open(turns(1));
    const projectId = await seed(fixture);
    let reached!: () => void;
    const atSuccessor = new Promise<void>(resolve => {
      reached = resolve;
    });
    const original = RegisteredChildRunInvoker.prototype.invoke;
    vi.spyOn(RegisteredChildRunInvoker.prototype, 'invoke').mockImplementation(async function (
      this: RegisteredChildRunInvoker,
      call
    ) {
      if (call.promptKey === 'research_investigation_review_v1') {
        const signal = call.parentToolContext.abortSignal;
        if (!signal) throw new Error('Missing research cancellation signal');
        reached();
        await new Promise<void>(resolve =>
          signal.addEventListener('abort', () => resolve(), { once: true })
        );
        signal.throwIfAborted();
      }
      return original.call(this, call);
    });
    const pending = fixture.flow.next(request(projectId), () => {});
    await atSuccessor;
    const owner = await identity(fixture, projectId);
    expect(
      new SqliteResearchStageReceiptStore(fixture.db).list(owner).filter(item => item.artifact)
    ).toHaveLength(1);
    await fixture.flow.cancelRun(owner.parentRunId, conversationId, 'Research user cancellation');
    await pending;
    expect(await children(fixture, owner)).toHaveLength(1);
    expect(
      (await fixture.runtime.supervisor.peek(RunIdSchema.parse(owner.parentRunId)))?.status
    ).toBe('cancelled');
    fixture.ai.assertAllTurnsConsumed();
    await close(fixture);
    const reloaded = await open([]);
    expect(await children(reloaded, owner)).toHaveLength(1);
    expect((await reloaded.flow.getActiveForegroundRun(conversationId)).run).toBeNull();
    expect(
      new SqliteResearchStageReceiptStore(reloaded.db).list(owner).filter(item => item.artifact)
    ).toHaveLength(1);
  });
});
