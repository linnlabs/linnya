import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CompleteResearchResultSchema,
  ResearchRunArgsSchema,
  type ResearchStage,
} from '@app/schemas';
import type { ScriptedLlmTurn } from '@linnlabs/linnkit/testkit';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import { graph } from '@linnlabs/linnkit/runtime-kernel';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from '../../../plugin-registry/pluginRuntimeState';
import {
  createDurableFlowHarness,
  installRecoveryModelFixture,
} from '../__test-helpers__/createDurableFlowHarness';
import { createWorkspaceResearchDocumentPort } from '../../research-documents';
import { SqliteResearchStageReceiptStore } from '../../persistence/research-stage-receipts';
import {
  readSubrunTrace,
  readTail,
} from '../../persistence/event-store/ui-projection/sqliteUiMessagesReader';
import { RegisteredChildRunInvoker } from '../../child-runs/registeredSubagentInvoker';
import { toolRegistry } from '../../tools/toolRegistry';

const conversationId = 'lead-research-conversation';
const modelId = 'scripted-test-model';
const scope = ResearchRunArgsSchema.parse({
  question: 'Explain the observed change without inventing its cause.',
  reader: 'General reader',
  task_type: 'fixed',
  materials: ['workspace:/source.md'],
});
let directory: string;
const closers: Array<() => void> = [];
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'linnya-research-lead-'));
  setPluginRuntimeStateForTests({
    installedPluginIds: ['platform'],
    enabledPluginIds: ['platform'],
  });
  installRecoveryModelFixture({ supported_efforts: ['low', 'high'], default_effort: 'low' });
});
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (const close of closers.splice(0).reverse()) close();
  resetAgentRuntimeSingletonsForTest();
  clearPluginRuntimeStateForTests();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});
async function open(turns: ScriptedLlmTurn[]) {
  const fixture = await createDurableFlowHarness(join(directory, 'workspace.sqlite'), turns);
  closers.push(fixture.close);
  return fixture;
}
type Fixture = Awaited<ReturnType<typeof open>>;
async function close(fixture: Fixture) {
  await new Promise(resolve => setTimeout(resolve, 0));
  fixture.close();
  closers.pop();
  resetAgentRuntimeSingletonsForTest();
}
async function seed(fixture: Fixture) {
  const projectId = new WorkspaceService(fixture.db).createProject('Lead acceptance');
  await fixture.eventStore.ensureConversation(conversationId, [], projectId, 'agent');
  await fixture.eventStore.ensureConversation('seed', [], projectId, 'agent');
  await fixture.eventStore.beginRunSession('seed', 'seed-run', { kind: 'agent' });
  await createWorkspaceResearchDocumentPort({
    db: fixture.db,
    eventStore: fixture.eventStore,
  }).save({
    projectId,
    conversationId: 'seed',
    sourceRunId: 'seed-run',
    path: 'workspace:/source.md',
    text: '# Source\n\nBaseline is 100; current is 110.',
    receipt: { prepare() {}, commit() {} },
  });
  return projectId;
}
async function start(fixture: Fixture, projectId: string) {
  await fixture.flow.next(
    {
      conversation_id: conversationId,
      project_id: projectId,
      new_events: [{ type: 'user_input', content: scope.question, source: 'user', timestamp: 1 }],
      options: {
        promptKey: 'research_v1',
        model_id: modelId,
        reasoning_effort: 'high',
        research_scope: scope,
        project_metadata: { id: projectId, name: 'Lead acceptance' },
      },
    },
    () => {}
  );
}
async function facts(fixture: Fixture) {
  return (await fixture.eventStore.readEvents(conversationId, { limit: 1000 })).events;
}
function pathInMessages(messages: unknown, stage: ResearchStage): string {
  const path = JSON.stringify(messages).match(
    new RegExp(`workspace:/research-[a-f0-9]{16}-${stage}\\.md`)
  )?.[0];
  if (!path) throw new Error(`Lead has no returned ${stage} path`);
  return path;
}
function assignment(stage: ResearchStage, inputs: ResearchStage[]): ScriptedLlmTurn {
  const tool = { id: `delegate-${stage}`, name: 'subagent', argumentsJson: '' };
  return {
    contentChunks: [`I am delegating ${stage}.`],
    toolCalls: [tool],
    assertCall(call) {
      expect(call.modelId).toBe(modelId);
      expect(call.options.reasoning_effort).toBe('high');
      const exposed = call.options.tools?.map(item => item.name) ?? [];
      expect(exposed).toContain('subagent');
      expect(exposed).toContain('complete_research');
      expect(exposed).toContain('submit_research_document');
      for (const name of ['research_run', 'write_file', 'edit_file'])
        expect(exposed).not.toContain(name);
      tool.argumentsJson = JSON.stringify({
        description: stage,
        prompt: 'Use the admitted source and distinguish observation from cause.',
        subagent_type: `research_${stage}`,
        input_documents: [
          'workspace:/source.md',
          ...inputs.map(input => pathInMessages(call.messages, input)),
        ],
      });
    },
  };
}
function submission(stage: ResearchStage): ScriptedLlmTurn {
  return {
    toolCalls: [
      {
        id: `submit-${stage}`,
        name: 'submit_research_document',
        argumentsJson: JSON.stringify({
          content: `# ${stage}\n\nThe supplied value rose from 100 to 110. This establishes a 10% change, not its cause.`,
        }),
      },
    ],
    assertCall(call) {
      expect(call.modelId).toBe(modelId);
      expect(JSON.stringify(call.messages)).toContain(`# Research stage: ${stage}`);
      const exposed = call.options.tools?.map(item => item.name) ?? [];
      expect(exposed).toContain('submit_research_document');
      for (const name of [
        'subagent',
        'research_run',
        'complete_research',
        'write_file',
        'edit_file',
      ])
        expect(exposed).not.toContain(name);
    },
  };
}
function complete(): ScriptedLlmTurn {
  const tool = { id: 'delivery', name: 'complete_research', argumentsJson: '' };
  return {
    toolCalls: [tool],
    assertCall(call) {
      tool.argumentsJson = JSON.stringify({ document: pathInMessages(call.messages, 'revision') });
    },
  };
}
function parentSubmission(
  stage: 'investigation' | 'draft' | 'revision',
  inputs: ResearchStage[]
): ScriptedLlmTurn {
  const tool = {
    id: `parent-submit-${stage}`,
    name: 'submit_research_document',
    argumentsJson: '',
  };
  return {
    toolCalls: [tool],
    assertCall(call) {
      expect(call.modelId).toBe(modelId);
      expect(call.options.tools?.map(item => item.name)).toContain('subagent');
      tool.argumentsJson = JSON.stringify({
        stage,
        input_documents: [
          'workspace:/source.md',
          ...inputs.map(input => pathInMessages(call.messages, input)),
        ],
        content: `# ${stage}\n\nThe supplied value rose from 100 to 110, a 10% change. Its cause is not identified.`,
      });
    },
  };
}
function chain(): ScriptedLlmTurn[] {
  return [
    parentSubmission('investigation', []),
    parentSubmission('draft', ['investigation']),
    assignment('argument_review', ['investigation', 'draft']),
    submission('argument_review'),
    assignment('source_review', ['investigation', 'draft']),
    submission('source_review'),
    parentSubmission('revision', ['investigation', 'draft', 'argument_review', 'source_review']),
    complete(),
  ];
}
async function assertDelivered(fixture: Fixture, projectId: string) {
  const events = await facts(fixture);
  const delivery = events.find(
    event => event.type === 'tool_output' && event.tool_name === 'complete_research'
  );
  if (!delivery || delivery.type !== 'tool_output') throw new Error('No final receipt');
  expect(delivery.status).toBe('success');
  const result = CompleteResearchResultSchema.parse({
    data: delivery.data,
    observation: delivery.observation,
  });
  expect(result.data.review_artifacts.map(item => item.stage)).toEqual([
    'argument_review',
    'source_review',
  ]);
  const children = (
    await fixture.runtime.supervisor.list({ parentRunId: RunIdSchema.parse(delivery.run_id) })
  ).runs;
  expect(children).toHaveLength(2);
  expect(children.every(child => child.status === 'completed')).toBe(true);
  expect(
    events.filter(
      event => event.type === 'tool_call_decision' && event.tool_name === 'research_run'
    )
  ).toHaveLength(0);
  // 终态释放 descriptor；冻结范围保存在实际阶段回执，不能依赖已清理的运行资源。
  expect(await fixture.runtime.runDescriptors?.load(delivery.run_id)).toBeNull();
  const receipts = new SqliteResearchStageReceiptStore(fixture.db).listRun({
    parentRunId: delivery.run_id,
    projectId,
    conversationId,
    modelId,
  });
  expect(receipts).toHaveLength(5);
  for (const { identity, receipt } of receipts) {
    expect(receipt.artifact).toBeDefined();
    expect(receipt.invocation).toEqual(scope);
    if ('runId' in receipt) {
      expect(receipt.runId).toBe(delivery.run_id);
      continue;
    }
    const trace = readSubrunTrace(
      fixture.db,
      conversationId,
      identity.toolCallId,
      receipt.subrunId
    );
    if (trace.status !== 'ready') throw new Error('Missing individual delegation trace');
    expect(trace.events.some(event => event.kind === 'final_answer')).toBe(true);
  }
  const projection = readTail(fixture.db, conversationId, 100);
  if (projection.status !== 'ready') throw new Error('Missing root projection');
  expect(projection.messages.filter(message => message.message_type === 'tool_calls')).toHaveLength(
    6
  );
  expect(new WorkspaceService(fixture.db).getChildNodes(null, projectId)).toHaveLength(6);
  expect((await fixture.flow.getActiveForegroundRun(conversationId)).run).toBeNull();
  fixture.ai.assertAllTurnsConsumed();
  return { parentRunId: delivery.run_id, result };
}

describe('Lead research through unified subagent and durable document handoff', () => {
  it('同项目评审根搜索不能串读同伴稿，显式路径也拒绝；父级仍可汇总两份评审', async () => {
    const marker = 'Only the argument reviewer knows this synthetic criticism.';
    const argument = submission('argument_review');
    const argumentCall = argument.toolCalls?.[0];
    if (!argumentCall) throw new Error('Missing argument submission');
    argumentCall.argumentsJson = JSON.stringify({ content: `# Argument review\n\n${marker}` });
    let peerPath = '';
    const parentSearch: ScriptedLlmTurn = {
      toolCalls: [
        { id: 'parent-search', name: 'grep', argumentsJson: JSON.stringify({ pattern: marker }) },
      ],
      assertCall(call) {
        peerPath = pathInMessages(call.messages, 'argument_review');
      },
    };
    const explicitRead = { id: 'reviewer-read-peer', name: 'read_file', argumentsJson: '' };
    const reviewerRead: ScriptedLlmTurn = {
      toolCalls: [explicitRead],
      assertCall() {
        explicitRead.argumentsJson = JSON.stringify({ locator: peerPath });
      },
    };
    const fixture = await open([
      parentSubmission('investigation', []),
      parentSubmission('draft', ['investigation']),
      assignment('argument_review', ['investigation', 'draft']),
      argument,
      parentSearch,
      assignment('source_review', ['investigation', 'draft']),
      {
        toolCalls: [
          {
            id: 'reviewer-search',
            name: 'grep',
            argumentsJson: JSON.stringify({ pattern: marker, locator: 'workspace:/' }),
          },
        ],
      },
      reviewerRead,
      {
        toolCalls: [
          {
            id: 'reviewer-read-source',
            name: 'read_file',
            argumentsJson: JSON.stringify({ locator: 'workspace:/source.md' }),
          },
        ],
      },
      submission('source_review'),
      parentSubmission('revision', ['investigation', 'draft', 'argument_review', 'source_review']),
      complete(),
    ]);
    const projectId = await seed(fixture);
    await start(fixture, projectId);
    const events = await facts(fixture);
    const output = (id: string) => {
      const event = events.find(item => item.type === 'tool_output' && item.tool_call_id === id);
      if (!event || event.type !== 'tool_output') throw new Error(`Missing ${id}`);
      return event;
    };
    expect(output('parent-search')).toMatchObject({ status: 'success' });
    expect(output('parent-search').observation).toContain(marker);
    expect(output('reviewer-search')).toMatchObject({
      status: 'success',
      data: { total_count: 0 },
    });
    expect(output('reviewer-search').observation).not.toContain(peerPath);
    expect(output('reviewer-read-peer')).toMatchObject({ status: 'error' });
    expect(output('reviewer-read-peer').observation).not.toContain(marker);
    expect(output('reviewer-read-source')).toMatchObject({ status: 'success' });
    expect(output('reviewer-read-source').observation).toContain('Baseline is 100');
    expect(
      events.find(event => event.type === 'tool_output' && event.tool_name === 'complete_research')
    ).toMatchObject({ status: 'success' });
    fixture.ai.assertAllTurnsConsumed();
  });

  it('父模型自己保存调查、初稿和修订，仅双复核使用child，重载保留独立提交与委派', async () => {
    const fixture = await open(chain());
    const projectId = await seed(fixture);
    await start(fixture, projectId);
    const delivered = await assertDelivered(fixture, projectId);
    expect(fixture.ai.getCalls()).toHaveLength(8);
    await close(fixture);
    const reloaded = await open([]);
    const projection = readTail(reloaded.db, conversationId, 100);
    if (projection.status !== 'ready') throw new Error('Missing reload');
    expect(
      projection.messages.filter(message => message.message_type === 'tool_calls')
    ).toHaveLength(6);
    expect(
      (await reloaded.runtime.supervisor.peek(RunIdSchema.parse(delivered.parentRunId)))?.status
    ).toBe('completed');
  });
  it('child已提交但父工具未接纳时恢复原委派，不重复文档或模型调用', async () => {
    const first = await open(chain().slice(0, 4));
    const projectId = await seed(first);
    const original = RegisteredChildRunInvoker.prototype.invoke;
    const interception = vi
      .spyOn(RegisteredChildRunInvoker.prototype, 'invoke')
      .mockImplementation(async function (this: RegisteredChildRunInvoker, call) {
        await original.call(this, call);
        throw new graph.RunRecoveryBlockedError(
          'Interrupted after child completion before parent acceptance'
        );
      });
    await start(first, projectId);
    const root = (await first.flow.getActiveForegroundRun(conversationId)).run;
    if (!root || root.status !== 'paused' || !root.pause?.settled || !root.execution_id)
      throw new Error('Expected settled pause');
    const originalChildren = (
      await first.runtime.supervisor.list({ parentRunId: RunIdSchema.parse(root.run_id) })
    ).runs;
    expect(originalChildren).toHaveLength(1);
    expect(originalChildren[0]?.status).toBe('completed');
    first.ai.assertAllTurnsConsumed();
    interception.mockRestore();
    await close(first);
    const resumed = await open(chain().slice(4));
    const current = (await resumed.flow.getActiveForegroundRun(conversationId)).run;
    if (!current || current.status !== 'paused' || !current.pause?.settled || !current.execution_id)
      throw new Error('Missing recovered pause');
    await resumed.flow.continueRun(
      root.run_id,
      {
        conversation_id: conversationId,
        expected_execution_id: current.execution_id,
        expected_updated_at: current.pause.updated_at,
      },
      () => {}
    );
    await assertDelivered(resumed, projectId);
    expect(resumed.ai.getCalls()).toHaveLength(4);
    expect(
      (
        await resumed.runtime.supervisor.list({ parentRunId: RunIdSchema.parse(root.run_id) })
      ).runs.map(item => item.runId)
    ).toContain(originalChildren[0]?.runId);
  });
  it('父稿与结果已经提交但工具输出中断时，恢复原稿并继续研究，不重复写入或提前结束', async () => {
    const first = await open(chain().slice(0, 1));
    const projectId = await seed(first);
    const tool = toolRegistry.getTool('submit_research_document');
    if (!tool) throw new Error('Missing submission tool');
    const original = tool.run.bind(tool);
    const interruption = vi.spyOn(tool, 'run').mockImplementation(async (args, context) => {
      const output = JSON.parse(await original(args, context));
      expect(output).not.toHaveProperty('control');
      throw new graph.RunRecoveryBlockedError('Interrupted after parent document commit');
    });
    await start(first, projectId);
    const root = (await first.flow.getActiveForegroundRun(conversationId)).run;
    if (!root || root.status !== 'paused' || !root.pause?.settled)
      throw new Error('Expected paused parent');
    const originalReceipt = new SqliteResearchStageReceiptStore(first.db).listRun({
      parentRunId: root.run_id,
      projectId,
      conversationId,
      modelId,
    })[0];
    if (!originalReceipt?.receipt.artifact) throw new Error('Missing committed parent document');
    expect(
      first.runtime.toolResults?.read(
        root.run_id,
        'parent-submit-investigation',
        'submit_research_document'
      )
    ).toMatchObject({ atomic_owner: 1 });
    expect(
      (await first.runtime.supervisor.list({ parentRunId: RunIdSchema.parse(root.run_id) })).runs
    ).toHaveLength(0);
    first.ai.assertAllTurnsConsumed();
    interruption.mockRestore();
    await close(first);
    const resumed = await open(chain().slice(1));
    const current = (await resumed.flow.getActiveForegroundRun(conversationId)).run;
    if (!current || !current.execution_id || !current.pause?.settled)
      throw new Error('Missing restored parent');
    await resumed.flow.continueRun(
      root.run_id,
      {
        conversation_id: conversationId,
        expected_execution_id: current.execution_id,
        expected_updated_at: current.pause.updated_at,
      },
      () => {}
    );
    await assertDelivered(resumed, projectId);
    const recovered = new SqliteResearchStageReceiptStore(resumed.db).list(
      originalReceipt.identity
    )[0];
    expect(recovered?.artifact).toEqual(originalReceipt?.receipt.artifact);
    expect(resumed.ai.getCalls()).toHaveLength(7);
  });
  it('fixed根检索和未提交child不能产生正式交付，主Agent仍能说明失败', async () => {
    const fixture = await open([
      {
        toolCalls: [
          {
            id: 'forbidden-search',
            name: 'web_search',
            argumentsJson: JSON.stringify({ query: 'new source' }),
          },
        ],
      },
      assignment('investigation', []),
      { contentChunks: ['I claim investigation is complete.'] },
      { contentChunks: ['No document was submitted; research has not been delivered.'] },
    ]);
    const projectId = await seed(fixture);
    const searchTool = toolRegistry.getTool('web_search');
    if (!searchTool) throw new Error('Missing search');
    const search = vi.spyOn(searchTool, 'run');
    await start(fixture, projectId);
    const events = await facts(fixture);
    expect(search).not.toHaveBeenCalled();
    expect(
      events.find(
        event => event.type === 'tool_output' && event.tool_call_id === 'forbidden-search'
      )
    ).toMatchObject({ status: 'error' });
    expect(
      events.find(
        event => event.type === 'tool_output' && event.tool_call_id === 'delegate-investigation'
      )
    ).toMatchObject({ status: 'error' });
    expect(
      events.filter(
        event => event.type === 'tool_output' && event.tool_name === 'complete_research'
      )
    ).toHaveLength(0);
    expect(new WorkspaceService(fixture.db).getChildNodes(null, projectId)).toHaveLength(1);
    fixture.ai.assertAllTurnsConsumed();
  });
  it('用户取消实际child会向上传播，未提交稿不落盘，重启不重新委派', async () => {
    const fixture = await open([assignment('investigation', []), submission('investigation')]);
    const projectId = await seed(fixture);
    const tool = toolRegistry.getTool('submit_research_document');
    if (!tool) throw new Error('Missing submission tool');
    let reached!: () => void;
    const ready = new Promise<void>(resolve => {
      reached = resolve;
    });
    vi.spyOn(tool, 'run').mockImplementation(async (_args, context) => {
      const signal = context.abortSignal;
      if (!signal) throw new Error('Missing child cancellation signal');
      reached();
      await new Promise<void>(resolve =>
        signal.addEventListener('abort', () => resolve(), { once: true })
      );
      signal.throwIfAborted();
      throw new Error('Cancellation must abort the child');
    });
    const pending = start(fixture, projectId);
    await ready;
    const root = (await fixture.flow.getActiveForegroundRun(conversationId)).run;
    if (!root) throw new Error('Missing active root');
    await fixture.flow.cancelRun(root.run_id, conversationId, 'User cancelled research');
    await pending;
    const children = (
      await fixture.runtime.supervisor.list({ parentRunId: RunIdSchema.parse(root.run_id) })
    ).runs;
    expect(children).toHaveLength(1);
    expect(children[0]?.status).toBe('cancelled');
    expect((await fixture.runtime.supervisor.peek(RunIdSchema.parse(root.run_id)))?.status).toBe(
      'cancelled'
    );
    expect(new WorkspaceService(fixture.db).getChildNodes(null, projectId)).toHaveLength(1);
    fixture.ai.assertAllTurnsConsumed();
    await close(fixture);
    const resumed = await open([]);
    expect((await resumed.flow.getActiveForegroundRun(conversationId)).run).toBeNull();
    expect(
      (await resumed.runtime.supervisor.list({ parentRunId: RunIdSchema.parse(root.run_id) })).runs
    ).toHaveLength(1);
  });
});
