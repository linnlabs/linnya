import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationNextRequest } from '@app/schemas';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
import {
  setPluginRuntimeStateForTests,
  clearPluginRuntimeStateForTests,
} from '../../../plugin-registry/pluginRuntimeState';
import {
  createDurableFlowHarness,
  installRecoveryModelFixture,
} from '../__test-helpers__/createDurableFlowHarness';
import { SubagentTool } from 'src/tools/agent_control/subrun/subagent/subagentTool';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import { graph } from '@linnlabs/linnkit/runtime-kernel';
import { WriteFileTool } from 'src/tools/workspace/write_file/WriteFileTool';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import {
  MarkdownDocumentService,
  MarkdownNormalizationService,
  buildMarkdownDocumentFromText,
} from 'src/domains/markdown';
import { BaseTool, type ToolContext } from 'src/tools/types';
import { AskTool } from 'src/tools/agent_control/ask/AskTool';
import { SQLiteRunRegistryStore } from '../../persistence/run-registry';

const conversationId = 'durable-conversation';
const request: ConversationNextRequest = {
  conversation_id: conversationId,
  new_events: [
    { type: 'user_input', content: 'Only the original user input', source: 'user', timestamp: 1 },
  ],
  options: { promptKey: 'default', model_id: 'scripted-test-model' },
};
let directory: string;
const closeFixtures: Array<() => void> = [];
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'linnya-durable-flow-'));
  setPluginRuntimeStateForTests({
    installedPluginIds: ['platform'],
    enabledPluginIds: ['platform'],
  });
  installRecoveryModelFixture();
});
afterEach(async () => {
  // Workspace 变更通知在下一个 macrotask 读取提交结果，关闭数据库前让 owner 完成发布。
  await new Promise(resolve => setTimeout(resolve, 0));
  for (const close of closeFixtures.splice(0).reverse()) close();
  resetAgentRuntimeSingletonsForTest();
  clearPluginRuntimeStateForTests();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});
async function open(
  turns: Parameters<typeof createDurableFlowHarness>[1],
  tools: Parameters<typeof createDurableFlowHarness>[2] = []
) {
  const fixture = await createDurableFlowHarness(join(directory, 'workspace.sqlite'), turns, tools);
  closeFixtures.push(fixture.close);
  return fixture;
}
async function paused(fixture: Awaited<ReturnType<typeof open>>) {
  const active = (await fixture.flow.getActiveForegroundRun(conversationId)).run;
  if (!active || active.status !== 'paused' || !active.pause?.settled || !active.execution_id) {
    throw new Error(`Expected settled pause: ${JSON.stringify(active)}`);
  }
  return { ...active, pause: active.pause, execution_id: active.execution_id };
}

describe('durable root Flow continuation, production Audit off', () => {
  it('用户暂停等待执行收口，继续保留预算并拒绝旧凭证和重复激活', async () => {
    let entered!: () => void;
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    class InterruptibleRead extends BaseTool {
      readonly name = 'read_file';
      readonly description = 'Read fixture';
      readonly parameters = { type: 'object' as const, properties: {}, required: [] };
      async run(_args: Record<string, unknown>, context: ToolContext): Promise<string> {
        const signal = context.abortSignal;
        if (!signal) throw new Error('Expected execution abort signal');
        entered();
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      }
    }
    const tool = new InterruptibleRead();
    const fixture = await open(
      [
        { toolCalls: [{ id: 'read-pause', name: 'read_file', argumentsJson: '{}' }] },
        { contentChunks: ['Continued'] },
      ],
      [tool]
    );
    const startSession = graph.GraphExecutor.prototype.startSession;
    vi.spyOn(graph.GraphExecutor.prototype, 'startSession').mockImplementation(async function (
      this: graph.GraphExecutor,
      ...args: Parameters<graph.GraphExecutor['startSession']>
    ) {
      try {
        return await startSession.apply(this, args);
      } catch {
        // 用户已请求暂停；随后执行收口的对账异常不能覆盖这一显式控制意图。
        throw new graph.RunRecoveryBlockedError('Execution reconciliation interrupted');
      }
    });
    const executing = fixture.flow.next(request, () => {});
    await started;
    const active = (await fixture.flow.getActiveForegroundRun(conversationId)).run;
    if (!active?.execution_id) throw new Error('Missing active execution');
    await fixture.flow.pauseRun(active.run_id, conversationId, active.execution_id);
    await executing;
    const root = await paused(fixture);
    expect(root.pause.reason).toBe('user_pause');
    expect(await new SQLiteRunRegistryStore(fixture.db).load(RunIdSchema.parse(root.run_id)))
      .toMatchObject({ status: 'paused', pauseReason: 'user_pause' });
    const used =
      (await fixture.checkpointer.load(root.run_id))?.local?.executorLocal?.stepCount ?? 0;
    vi.spyOn(tool, 'run').mockResolvedValue('Original read continued');
    const command = {
      conversation_id: conversationId,
      expected_execution_id: root.execution_id,
      expected_updated_at: root.pause.updated_at,
    };
    const competing = await Promise.allSettled([
      fixture.flow.continueRun(root.run_id, command, () => {}),
      fixture.flow.continueRun(root.run_id, command, () => {}),
    ]);
    expect(competing.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      (await fixture.runtime.supervisor.peek(RunIdSchema.parse(root.run_id)))?.iterationsUsed
    ).toBeGreaterThan(used);
    await expect(
      fixture.flow.pauseRun(root.run_id, conversationId, root.execution_id)
    ).rejects.toThrow();
    expect(
      (await fixture.eventStore.readEvents(conversationId, { limit: 100 })).events.filter(
        e => e.type === 'user_input'
      )
    ).toHaveLength(1);
  });

  it.each([false, true])(
    '审批重启保留原 interaction，修复提交窗口=%s',
    async interruptedBeforeLifecycle => {
      const first = await open(
        [
          {
            toolCalls: [
              {
                id: 'original-ask',
                name: 'ask',
                argumentsJson: JSON.stringify({
                  questions: [{ id: 'answer', type: 'text', question: 'What should be used?' }],
                }),
              },
            ],
          },
        ],
        [new AskTool()]
      );
      await first.flow.next(request, () => {});
      const waiting = (await first.flow.getActiveForegroundRun(conversationId)).run;
      expect(waiting?.status).toBe('awaiting_user');
      if (interruptedBeforeLifecycle) {
        first.db
          .prepare(
            "UPDATE runs SET status = 'running', metadata_json = json_remove(metadata_json, '$.awaitingUser') WHERE id = ?"
          )
          .run(waiting?.run_id);
      }
      first.close();
      closeFixtures.pop();
      resetAgentRuntimeSingletonsForTest();
      const resumed = await open(
        [{ contentChunks: ['Original approval continued'] }],
        [new AskTool()]
      );
      const root = (await resumed.flow.getActiveForegroundRun(conversationId)).run;
      expect(root).toMatchObject(waiting ?? {});
      if (!root?.pending_interaction) throw new Error('Missing original interaction');
      const pending = root.pending_interaction;
      await resumed.flow.respondInteraction(
        {
          conversation_id: conversationId,
          run_id: root.run_id,
          interaction_id: pending.interaction_id,
          resume_token: pending.resume_token,
          checkpoint_revision: pending.checkpoint_revision,
          tool_call_id: pending.tool_call_id,
          tool_name: 'ask',
          observation: 'Use the approved answer',
          data: {},
          interaction_status: 'submitted',
          interaction_submitted_at: Date.now(),
        },
        () => {}
      );
      expect(await resumed.flow.getActiveForegroundRun(conversationId)).toMatchObject({
        run: null,
      });
      expect(
        (await resumed.eventStore.readEvents(conversationId, { limit: 100 })).events.filter(
          e => e.type === 'user_input'
        )
      ).toHaveLength(1);
    }
  );

  it('审批响应激活后执行器未启动，重启消费已提交响应而不重开审批', async () => {
    const first = await open(
      [
        {
          toolCalls: [
            {
              id: 'activation-ask',
              name: 'ask',
              argumentsJson: JSON.stringify({
                questions: [{ id: 'answer', type: 'text', question: 'Choose' }],
              }),
            },
          ],
        },
      ],
      [new AskTool()]
    );
    await first.flow.next(request, () => {});
    const waiting = (await first.flow.getActiveForegroundRun(conversationId)).run;
    if (!waiting?.pending_interaction) throw new Error('Expected approval');
    const interaction = waiting.pending_interaction;
    vi.spyOn(first.runner, 'run').mockImplementation(() => {
      throw new Error('executor unavailable after admission');
    });
    await expect(
      first.flow.respondInteraction(
        {
          conversation_id: conversationId,
          ...interaction,
          tool_name: 'ask',
          observation: 'Original committed answer',
          data: {},
          interaction_status: 'submitted',
          interaction_submitted_at: Date.now(),
        },
        () => {}
      )
    ).rejects.toThrow();
    first.close();
    closeFixtures.pop();
    resetAgentRuntimeSingletonsForTest();
    const resumed = await open([{ contentChunks: ['Response consumed'] }], [new AskTool()]);
    const root = await paused(resumed);
    await resumed.flow.continueRun(
      root.run_id,
      {
        conversation_id: conversationId,
        expected_execution_id: root.execution_id,
        expected_updated_at: root.pause.updated_at,
      },
      () => {}
    );
    expect(await resumed.flow.getActiveForegroundRun(conversationId)).toMatchObject({ run: null });
    const facts = (await resumed.eventStore.readEvents(conversationId, { limit: 100 })).events;
    expect(facts.filter(event => event.type === 'user_input')).toHaveLength(1);
    expect(
      facts.filter(event => event.type === 'tool_output' && event.tool_call_id === 'activation-ask')
    ).toHaveLength(1);
    resumed.ai.assertAllTurnsConsumed();
  });

  it('未知外部效果在重启后保持受阻，绝不重放调用', async () => {
    class UnknownEffect extends BaseTool {
      readonly name = 'shell';
      readonly description = 'Unresolved external effect';
      readonly parameters = { type: 'object' as const, properties: {}, required: [] };
      async run(): Promise<string> {
        throw new graph.RunRecoveryBlockedError('External effect is unknown');
      }
    }
    const first = await open(
      [{ toolCalls: [{ id: 'unknown-call', name: 'shell', argumentsJson: '{}' }] }],
      [new UnknownEffect()]
    );
    await first.flow.next(request, () => {});
    expect(first.getToolExecutions()).toHaveLength(1);
    first.close();
    closeFixtures.pop();
    resetAgentRuntimeSingletonsForTest();
    const resumed = await open([], [new UnknownEffect()]);
    const root = await paused(resumed);
    await resumed.flow.continueRun(
      root.run_id,
      {
        conversation_id: conversationId,
        expected_execution_id: root.execution_id,
        expected_updated_at: root.pause.updated_at,
      },
      () => {}
    );
    expect((await paused(resumed)).pause.reason).toBe('tool_reconciliation_required');
    expect(resumed.getToolExecutions()).toHaveLength(0);
    expect(resumed.ai.getConsumedTurnCount()).toBe(0);
  });

  it.each(['create', 'update'])(
    'Markdown %s 后 terminal 写入失败，恢复原结果而不覆盖用户后续修改',
    async operation => {
      const first = await open(
        [
          {
            toolCalls: [
              {
                id: 'original-write',
                name: 'write_file',
                argumentsJson: JSON.stringify({
                  locator: 'workspace:/recovery.md',
                  content: 'Original tool content',
                }),
              },
            ],
          },
        ],
        [new WriteFileTool()]
      );
      const projectId = new WorkspaceService(first.db).createProject('Recovery');
      await first.eventStore.ensureConversation(conversationId, [], projectId, 'agent');
      if (operation === 'update') {
        const id = new WorkspaceService(first.db).createDocument(
          projectId,
          'recovery.md',
          undefined,
          'document'
        );
        const documents = new MarkdownDocumentService(first.db);
        const initial = await buildMarkdownDocumentFromText({
          markdown: 'Existing document',
          normalizer: new MarkdownNormalizationService(first.db, documents),
          resolveCitationSources: async () => [],
        });
        documents.createDocument(id, initial.content);
      }
      first.db
        .exec(`CREATE TRIGGER reject_write_terminal BEFORE INSERT ON events WHEN NEW.type = 'tool_output'
      BEGIN SELECT RAISE(ABORT, 'write terminal unavailable'); END;`);
      await expect(
        first.flow.next(
          {
            ...request,
            project_id: projectId,
            options: { ...request.options, project_metadata: { id: projectId, name: 'Recovery' } },
          },
          () => {}
        )
      ).rejects.toThrow('write terminal unavailable');
      const original = await paused(first);
      const receipt = first.runtime.toolResults?.read(
        original.run_id,
        'original-write',
        'write_file'
      );
      expect(receipt?.result).toContain('recovery.md');
      const node = first.db
        .prepare<[], { id: string }>("SELECT id FROM workspace_nodes WHERE name = 'recovery.md'")
        .get();
      if (!node) throw new Error('Expected committed Markdown document');
      const documents = new MarkdownDocumentService(first.db);
      const userContent = await buildMarkdownDocumentFromText({
        markdown: 'User later content',
        normalizer: new MarkdownNormalizationService(first.db, documents),
        resolveCitationSources: async () => [],
      });
      const userVersion = documents.updateDocument(node.id, userContent.content);
      first.db.exec('DROP TRIGGER reject_write_terminal');
      await new Promise(resolve => setTimeout(resolve, 0));
      first.close();
      closeFixtures.pop();
      resetAgentRuntimeSingletonsForTest();
      const resumed = await open(
        [{ contentChunks: ['Original file operation completed'] }],
        [new WriteFileTool()]
      );
      const root = await paused(resumed);
      await resumed.flow.continueRun(
        root.run_id,
        {
          conversation_id: conversationId,
          expected_execution_id: root.execution_id,
          expected_updated_at: root.pause.updated_at,
        },
        () => {}
      );
      expect(resumed.getToolExecutions()).toHaveLength(0);
      expect(new MarkdownDocumentService(resumed.db).getLatestVersion(node.id)?.id).toBe(
        userVersion.id
      );
      const facts = (await resumed.eventStore.readEvents(conversationId, { limit: 100 })).events;
      expect(facts.filter(event => event.type === 'user_input')).toHaveLength(1);
      expect(
        facts.filter(
          event => event.type === 'tool_output' && event.tool_call_id === 'original-write'
        )
      ).toHaveLength(1);
      expect(await resumed.flow.getActiveForegroundRun(conversationId)).toMatchObject({
        run: null,
      });
      resumed.ai.assertAllTurnsConsumed();
    }
  );

  it('结果凭据写入失败时，受管文档创建随同事务回滚', async () => {
    const fixture = await open(
      [
        {
          toolCalls: [
            {
              id: 'rollback-write',
              name: 'write_file',
              argumentsJson: JSON.stringify({
                locator: 'workspace:/rollback.md',
                content: 'Must roll back',
              }),
            },
          ],
        },
        { contentChunks: ['Write was rejected'] },
      ],
      [new WriteFileTool()]
    );
    const projectId = new WorkspaceService(fixture.db).createProject('Recovery');
    fixture.db.exec(`CREATE TRIGGER reject_receipt BEFORE UPDATE OF result ON agent_tool_results
      BEGIN SELECT RAISE(ABORT, 'receipt unavailable'); END;`);
    await fixture.flow.next(
      {
        ...request,
        project_id: projectId,
        options: { ...request.options, project_metadata: { id: projectId, name: 'Recovery' } },
      },
      () => {}
    );
    expect(fixture.getToolExecutions()).toHaveLength(1);
    expect(
      fixture.db.prepare("SELECT id FROM workspace_nodes WHERE name = 'rollback.md'").all()
    ).toHaveLength(0);
    const facts = (await fixture.eventStore.readEvents(conversationId, { limit: 100 })).events;
    expect(
      facts.find(event => event.type === 'tool_output' && event.tool_call_id === 'rollback-write')
    ).toMatchObject({ error: expect.stringContaining('receipt unavailable') });
  });

  it('损坏的原描述只隔离该运行，不阻止其他对话恢复且不删除诊断输入', async () => {
    const first = await open([
      { throwAfterEvents: new Error('interrupted') },
      { throwAfterEvents: new Error('interrupted') },
    ]);
    await first.flow.next(request, () => {});
    const broken = await paused(first);
    await first.flow.next({ ...request, conversation_id: 'other-conversation' }, () => {});
    first.db
      .prepare("UPDATE agent_run_descriptors SET descriptor_json = 'invalid-json' WHERE run_id = ?")
      .run(broken.run_id);
    first.close();
    closeFixtures.pop();
    resetAgentRuntimeSingletonsForTest();
    const resumed = await open([]);
    expect(await resumed.runtime.supervisor.peek(RunIdSchema.parse(broken.run_id))).toMatchObject({
      status: 'failed',
      errorIfAny: { errorCode: 'RUN_RECOVERY_INPUT_INVALID' },
    });
    expect((await resumed.flow.getActiveForegroundRun('other-conversation')).run?.status).toBe(
      'paused'
    );
    expect(await resumed.runtime.runDescriptors?.exists(broken.run_id)).toBe(true);
    expect(resumed.ai.getConsumedTurnCount()).toBe(0);
  });

  it.each(['parent_terminal', 'child_settlement'] as const)(
    'child 结果已提交但 %s 失败，重启只复用原 child 结果',
    async failurePoint => {
      const first = await open(
        [
          {
            toolCalls: [
              {
                id: 'completed-child-call',
                name: 'subagent',
                argumentsJson: JSON.stringify({ description: 'Inspect', prompt: 'Child task' }),
              },
            ],
          },
          { contentChunks: ['Original child result'] },
        ],
        [new SubagentTool()]
      );
      if (failurePoint === 'parent_terminal') {
        first.db.exec(`CREATE TRIGGER reject_child_result BEFORE INSERT ON events
        WHEN NEW.type = 'tool_output' AND NEW.run_id IN (SELECT id FROM runs WHERE parent_run_id IS NULL)
        BEGIN SELECT RAISE(ABORT, 'parent terminal unavailable'); END;`);
        await expect(first.flow.next(request, () => {})).rejects.toThrow(
          'parent terminal unavailable'
        );
      } else {
        first.db.exec(`CREATE TRIGGER reject_child_result BEFORE UPDATE OF status ON runs
        WHEN NEW.status = 'completed' AND NEW.parent_run_id IS NOT NULL
        BEGIN SELECT RAISE(ABORT, 'child settlement unavailable'); END;`);
        await first.flow.next(request, () => {});
      }
      const original = await paused(first);
      const children = (
        await first.runtime.supervisor.list({ parentRunId: RunIdSchema.parse(original.run_id) })
      ).runs;
      expect(children).toHaveLength(1);
      expect(children[0]?.status).toBe(failurePoint === 'parent_terminal' ? 'completed' : 'paused');
      first.db.exec('DROP TRIGGER reject_child_result');
      first.close();
      closeFixtures.pop();
      resetAgentRuntimeSingletonsForTest();
      const resumed = await open([{ contentChunks: ['Parent final'] }], [new SubagentTool()]);
      const root = await paused(resumed);
      await resumed.flow.continueRun(
        root.run_id,
        {
          conversation_id: conversationId,
          expected_execution_id: root.execution_id,
          expected_updated_at: root.pause.updated_at,
        },
        () => {}
      );
      expect(await resumed.flow.getActiveForegroundRun(conversationId)).toMatchObject({
        run: null,
      });
      expect(resumed.db.prepare('SELECT run_id FROM agent_run_descriptors').all()).toHaveLength(0);
      expect(
        resumed.db.prepare('SELECT conversation_id FROM engine_checkpoints').all()
      ).toHaveLength(0);
      const facts = (await resumed.eventStore.readEvents(conversationId, { limit: 100 })).events;
      expect(facts.filter(event => event.type === 'user_input')).toHaveLength(2);
      expect(
        facts.filter(
          event => event.type === 'tool_output' && event.tool_call_id === 'completed-child-call'
        )
      ).toHaveLength(1);
      resumed.ai.assertAllTurnsConsumed();
    }
  );

  it.each([false, true])(
    '子 Agent 中断后保留原关系，父终态先落盘=%s',
    async terminalBeforeRestart => {
      const first = await open(
        [
          {
            toolCalls: [
              {
                id: 'original-child-call',
                name: 'subagent',
                argumentsJson: JSON.stringify({
                  description: 'Inspect',
                  prompt: 'Child original task',
                }),
              },
            ],
          },
          { throwAfterEvents: new Error('child network interrupted') },
        ],
        [new SubagentTool()]
      );
      await first.flow.next(request, () => {});
      const original = await paused(first);
      const children = (
        await first.runtime.supervisor.list({ parentRunId: RunIdSchema.parse(original.run_id) })
      ).runs;
      expect(children).toHaveLength(1);
      expect(children[0]?.status).toBe('paused');
      const childId = children[0]?.runId;
      if (terminalBeforeRestart) {
        first.db.prepare("UPDATE runs SET status = 'cancelled' WHERE id = ?").run(original.run_id);
      }
      first.close();
      closeFixtures.pop();
      resetAgentRuntimeSingletonsForTest();
      const resumed = await open(
        terminalBeforeRestart
          ? []
          : [
              { contentChunks: ['Original child completed'] },
              { contentChunks: ['Parent completed'] },
            ],
        [new SubagentTool()]
      );
      if (terminalBeforeRestart) {
        const tree = await resumed.runtime.supervisor.findByConversation(conversationId, {
          includeChildren: true,
        });
        expect(tree.every(run => run.status === 'cancelled')).toBe(true);
        expect(resumed.db.prepare('SELECT run_id FROM agent_run_descriptors').all()).toHaveLength(
          0
        );
        expect(
          resumed.db.prepare('SELECT conversation_id FROM engine_checkpoints').all()
        ).toHaveLength(0);
        expect(resumed.ai.getConsumedTurnCount()).toBe(0);
        return;
      }
      const root = await paused(resumed);
      await resumed.flow.continueRun(
        root.run_id,
        {
          conversation_id: conversationId,
          expected_execution_id: root.execution_id,
          expected_updated_at: root.pause.updated_at,
        },
        () => {}
      );
      const runs = await resumed.runtime.supervisor.findByConversation(conversationId, {
        includeChildren: true,
      });
      expect(runs.filter(run => run.parentRunId === root.run_id)).toHaveLength(1);
      expect(runs.find(run => run.runId === childId)?.status).toBe('completed');
      expect(runs.find(run => run.runId === root.run_id)?.status).toBe('completed');
      const facts = (await resumed.eventStore.readEvents(conversationId, { limit: 100 })).events;
      expect(facts.filter(event => event.type === 'user_input')).toHaveLength(2);
      expect(
        facts.filter(
          event => event.type === 'tool_output' && event.tool_call_id === 'original-child-call'
        )
      ).toHaveLength(1);
      resumed.ai.assertAllTurnsConsumed();
    }
  );

  it('未完成响应保留原 run，关闭数据库后重启并无消息继续，最终回答只提交一次', async () => {
    const first = await open([
      {
        contentChunks: ['uncommitted partial'],
        throwAfterEvents: new Error('network interrupted'),
      },
    ]);
    expect(first.runtime.auditEnabled).toBe(false);
    await first.flow.next(request, () => {});
    const original = await paused(first);
    const descriptor = await first.runtime.runDescriptors?.load(original.run_id);
    const checkpoint = await first.checkpointer.load(original.run_id);
    expect(descriptor?.request.frozenSystemPrompt).toBeTruthy();
    expect(checkpoint?.local?.executorLocal?.maxSteps).toBe(descriptor?.request.maxSteps);
    expect(checkpoint?.local?.executorLocal?.stepCount).toBeGreaterThan(0);
    first.close();
    closeFixtures.pop();
    resetAgentRuntimeSingletonsForTest();
    const restarted = await open([{ contentChunks: ['Durable final answer'] }]);
    const restored = await paused(restarted);
    expect(restored.run_id).toBe(original.run_id);
    expect(restarted.ai.getConsumedTurnCount()).toBe(0);
    await restarted.flow.continueRun(
      restored.run_id,
      {
        conversation_id: conversationId,
        expected_updated_at: restored.pause.updated_at,
        expected_execution_id: restored.execution_id,
      },
      () => {}
    );
    const facts = (await restarted.eventStore.readEvents(conversationId, { limit: 100 })).events;
    expect(facts.filter(event => event.type === 'user_input')).toHaveLength(1);
    expect(
      facts.filter(event => event.type === 'final_answer').map(event => event.content)
    ).toEqual(['Durable final answer']);
    expect(facts.every(event => event.run_id === original.run_id)).toBe(true);
    expect(await restarted.flow.getActiveForegroundRun(conversationId)).toMatchObject({
      run: null,
    });
    expect(await restarted.checkpointer.load(original.run_id)).toBeNull();
    expect(await restarted.runtime.runDescriptors?.load(original.run_id)).toBeNull();
    restarted.ai.assertAllTurnsConsumed();
  });

  it('新消息落盘失败保留原暂停 run；重试成功才替换旧运行', async () => {
    const fixture = await open([
      { throwAfterEvents: new Error('network interrupted') },
      { contentChunks: ['New input completed'] },
    ]);
    await fixture.flow.next(request, () => {});
    const original = await paused(fixture);
    fixture.db
      .exec(`CREATE TRIGGER reject_incoming BEFORE INSERT ON events WHEN NEW.type = 'user_input'
      BEGIN SELECT RAISE(ABORT, 'incoming unavailable'); END;`);
    const nextRequest: ConversationNextRequest = {
      ...request,
      new_events: [
        { type: 'user_input', content: 'New user message', timestamp: 2, source: 'user' },
      ],
    };
    await expect(fixture.flow.next(nextRequest, () => {})).rejects.toThrow();
    expect((await paused(fixture)).run_id).toBe(original.run_id);
    expect(await fixture.checkpointer.load(original.run_id)).not.toBeNull();
    fixture.db.exec('DROP TRIGGER reject_incoming');
    await fixture.flow.next(nextRequest, () => {});
    const records = await fixture.runtime.supervisor.findByConversation(conversationId);
    expect(records.find(run => run.runId === original.run_id)?.status).toBe('cancelled');
    expect(records.filter(run => run.status === 'completed')).toHaveLength(1);
    const facts = (await fixture.eventStore.readEvents(conversationId, { limit: 100 })).events;
    expect(facts.filter(event => event.type === 'user_input')).toHaveLength(2);
    fixture.ai.assertAllTurnsConsumed();
  });
});
