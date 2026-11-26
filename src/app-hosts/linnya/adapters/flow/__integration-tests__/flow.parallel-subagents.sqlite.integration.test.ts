import { createProjectLifecycle } from 'src/domains/projects';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import type { ScriptedLlmCall, ScriptedLlmTurn } from '@linnlabs/linnkit/testkit';
import type { ConversationNextRequest } from '@app/schemas';
import { SubagentResultSchema } from '@app/schemas';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
import { SubagentTool } from 'src/tools/agent_control/subrun/subagent/subagentTool';
import { BaseTool, type ToolContext } from 'src/tools/types';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from '../../../plugin-registry/pluginRuntimeState';
import * as agentDefinitions from '../../../agent-registry/agentDefinitionResolver';
import { clearRegisteredAgentTaskCache } from '../../../agent-registry/agentTaskResolver';
import { ToolRegistry, toolRegistry } from '../../tools/toolRegistry';
import {
  readSubrunTrace,
  readTail,
} from '../../persistence/event-store/ui-projection/sqliteUiMessagesReader';
import {
  createDurableFlowHarness,
  installRecoveryModelFixture,
} from '../__test-helpers__/createDurableFlowHarness';

/**
 * 一次回复里的多个 `subagent` 调用经真实 Flow、ToolRegistry、Linnkit 0.48 ToolNode、持久 child
 * 与 SQLite 并行执行。只替换上游模型；工具执行、结果凭据、断点与恢复都走产品装配。
 */
const conversationId = 'parallel-subagents-conversation';
const ROOT_QUERY = 'Run the parallel subagent fixture.';
const SERIAL_TOOL = 'serial_marker';
/** 判定“两个调用没有重叠”的上限：并行时远小于它，串行时会一直等到超时。 */
const OVERLAP_TIMEOUT_MS = 5_000;

let directory: string;
const closers: Array<() => void> = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'linnya-parallel-subagents-'));
  setPluginRuntimeStateForTests({
    installedPluginIds: ['platform'],
    enabledPluginIds: ['platform'],
  });
  installRecoveryModelFixture();
  // 根 Agent 只开放本场景的两个工具，避免技能激活等无关步骤消耗脚本回合。
  const findDefinition = agentDefinitions.findRegisteredAgentDefinitionByPromptKey;
  vi.spyOn(agentDefinitions, 'findRegisteredAgentDefinitionByPromptKey').mockImplementation(
    promptKey => {
      const definition = findDefinition(promptKey);
      if (promptKey !== 'default' || !definition) return definition;
      return {
        ...definition,
        config: {
          ...definition.config,
          availableTools: ['subagent', SERIAL_TOOL],
          skill: { enabled: false },
        },
      };
    }
  );
  clearRegisteredAgentTaskCache();
});

afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (const close of closers.splice(0).reverse()) close();
  resetAgentRuntimeSingletonsForTest();
  clearPluginRuntimeStateForTests();
  vi.restoreAllMocks();
  clearRegisteredAgentTaskCache();
  rmSync(directory, { recursive: true, force: true });
});

type Script = Parameters<typeof createDurableFlowHarness>[1];

async function open(script: Script) {
  const fixture = await createDurableFlowHarness(join(directory, 'workspace.sqlite'), script);
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

async function project(fixture: Fixture): Promise<string> {
  const projectId = createProjectLifecycle(fixture.db).create({ name: 'Parallel fixture' });
  await fixture.eventStore.ensureConversation(conversationId, [], projectId, 'agent');
  return projectId;
}

function request(projectId: string): ConversationNextRequest {
  return {
    conversation_id: conversationId,
    project_id: projectId,
    new_events: [{ type: 'user_input', content: ROOT_QUERY, source: 'user', timestamp: 1 }],
    options: {
      promptKey: 'default',
      model_id: 'scripted-test-model',
      project_metadata: { id: projectId, name: 'Parallel fixture' },
    },
  };
}

async function facts(fixture: Fixture) {
  return (await fixture.eventStore.readEvents(conversationId, { limit: 1000 })).events;
}

async function pausedRoot(fixture: Fixture) {
  const root = (await fixture.flow.getActiveForegroundRun(conversationId)).run;
  if (!root || root.status !== 'paused' || !root.pause?.settled || !root.execution_id)
    throw new Error(`Expected settled pause: ${JSON.stringify(root)}`);
  return { ...root, pause: root.pause, execution_id: root.execution_id };
}

/** 一次 subagent 调用：description 同时作为子任务标记和 child 最终答案的来源。 */
function subagentCall(id: string, description: string) {
  return {
    id,
    name: 'subagent',
    arguments: {
      description,
      prompt: `Answer the fixture task ${description} with one sentence.`,
      subagent_type: 'general',
    },
  };
}

function answerOf(description: string): string {
  return `${description} child answer.`;
}

/** 按请求内容路由：根 run 看得到用户原问题，child 只看得到自己的委派说明。 */
function classify(call: ScriptedLlmCall, descriptions: readonly string[]) {
  const text = JSON.stringify(call.messages);
  if (text.includes(ROOT_QUERY)) {
    return { kind: 'root' as const, toolResults: call.messages.filter(m => m.role === 'tool') };
  }
  const description = descriptions.find(item => text.includes(`fixture task ${item}`));
  if (!description) throw new Error(`Unrouted model call: ${text.slice(0, 300)}`);
  return { kind: 'child' as const, description };
}

/** 两个（或多个）参与方都到达后才放行；超时说明它们没有同时在跑。 */
function createRendezvous(names: readonly string[]) {
  const arrived = new Set<string>();
  let release!: () => void;
  const all = new Promise<void>(resolve => {
    release = resolve;
  });
  return {
    async arrive(name: string): Promise<void> {
      arrived.add(name);
      if (names.every(item => arrived.has(item))) release();
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        all,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`No overlap: only ${[...arrived].join(', ')} arrived`)),
            OVERLAP_TIMEOUT_MS
          );
        }),
      ]).finally(() => clearTimeout(timer));
    },
  };
}

type TimelineEntry = { readonly call: string; readonly at: 'start' | 'end' };

/**
 * 真实 SubagentTool 外包一层只做观测：记录每个调用的开始和结束，可选地在进入 child 前等待同伴。
 * 继承 `parallel = true`，因此也证明了产品工具本身的声明。
 */
class ObservedSubagentTool extends SubagentTool {
  readonly timeline: TimelineEntry[] = [];
  readonly abortedCalls = new Set<string>();

  constructor(
    private readonly beforeChild?: (callId: string) => Promise<void>,
    private readonly afterChild?: (callId: string) => Promise<void>
  ) {
    super();
  }

  override async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const callId = context.parentToolCallId;
    if (!callId) throw new Error('Missing per-call parent tool identity');
    this.timeline.push({ call: callId, at: 'start' });
    context.abortSignal?.addEventListener('abort', () => this.abortedCalls.add(callId), {
      once: true,
    });
    try {
      await this.beforeChild?.(callId);
      const output = await super.run(args, context);
      await this.afterChild?.(callId);
      return output;
    } finally {
      this.timeline.push({ call: callId, at: 'end' });
    }
  }
}

/** 未声明 parallel 的普通工具：是并行组之间的屏障。 */
class SerialMarkerTool extends BaseTool {
  readonly name = SERIAL_TOOL;
  readonly description = 'Fixture tool that must run alone.';
  readonly parameters = { type: 'object' as const, properties: {}, additionalProperties: false };

  constructor(private readonly timeline: TimelineEntry[]) {
    super();
  }

  async run(_args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const callId = context.parentToolCallId ?? 'missing';
    this.timeline.push({ call: callId, at: 'start' });
    await new Promise(resolve => setTimeout(resolve, 20));
    this.timeline.push({ call: callId, at: 'end' });
    return JSON.stringify({ observation: 'serial marker done', data: {} });
  }
}

/** 只替换工具查找；执行、参数校验、receipt 与错误分类仍经正式 ToolRegistry。 */
function installTools(tools: readonly BaseTool[]): void {
  const getTool = ToolRegistry.prototype.getTool.bind(toolRegistry);
  const supplied = new Map(tools.map(tool => [tool.name, tool]));
  vi.spyOn(toolRegistry, 'getTool').mockImplementation(name => supplied.get(name) ?? getTool(name));
}

function position(timeline: readonly TimelineEntry[], call: string, at: 'start' | 'end'): number {
  const index = timeline.findIndex(entry => entry.call === call && entry.at === at);
  if (index < 0) throw new Error(`Missing ${at} of ${call}: ${JSON.stringify(timeline)}`);
  return index;
}

type Fact = Awaited<ReturnType<typeof facts>>[number];
type ToolOutputFact = Extract<Fact, { type: 'tool_output' }>;

function isToolOutput(event: Fact): event is ToolOutputFact {
  return event.type === 'tool_output';
}

async function toolOutputs(fixture: Fixture): Promise<ToolOutputFact[]> {
  return (await facts(fixture)).filter(isToolOutput);
}

async function subagentOutputs(fixture: Fixture): Promise<ToolOutputFact[]> {
  return (await toolOutputs(fixture)).filter(event => event.tool_name === 'subagent');
}

/** parentToolCallId 来自持久恢复描述；root 结束后描述随终态回收，只在未结束时可读。 */
async function childRunsOf(fixture: Fixture, rootRunId: string) {
  const runs = (await fixture.runtime.supervisor.list({ parentRunId: RunIdSchema.parse(rootRunId) }))
    .runs;
  return Promise.all(
    runs.map(async run => ({
      run,
      parentToolCallId: (await fixture.runtime.runDescriptors?.load(run.runId))?.child
        ?.parentToolCallId,
    }))
  );
}

describe('一次回复里的多个 subagent 经 SQLite 并行执行', () => {
  it('两个调用真的重叠，结果、trace 和 child 各自挂在自己的父调用上；发给模型时按调用顺序', async () => {
    const descriptions = ['Alpha', 'Beta'];
    const childrenTogether = createRendezvous(descriptions);
    const callsTogether = createRendezvous(['call-alpha', 'call-beta']);
    let betaReturned!: () => void;
    const betaDone = new Promise<void>(resolve => {
      betaReturned = resolve;
    });
    let rootFinal: ScriptedLlmCall | undefined;
    const fixture = await open(async (call): Promise<ScriptedLlmTurn> => {
      const route = classify(call, descriptions);
      if (route.kind === 'root') {
        if (route.toolResults.length === 0) {
          return { toolCalls: [subagentCall('call-alpha', 'Alpha'), subagentCall('call-beta', 'Beta')] };
        }
        rootFinal = call;
        return { contentChunks: ['Both subtasks finished.'] };
      }
      // 两个 child 的模型调用必须同时在途；串行执行时先到者会一直等到超时。
      await childrenTogether.arrive(route.description);
      return { contentChunks: [answerOf(route.description)] };
    });
    const projectId = await project(fixture);
    const tool = new ObservedSubagentTool(
      callId => callsTogether.arrive(callId),
      // 让 Beta 先完成：历史里结果按完成先后排列，但发给模型时要排回调用顺序。
      async callId => (callId === 'call-beta' ? betaReturned() : betaDone)
    );
    installTools([tool]);

    await fixture.flow.next(request(projectId), () => {});

    expect(position(tool.timeline, 'call-beta', 'start')).toBeLessThan(
      position(tool.timeline, 'call-alpha', 'end')
    );
    const outputs = await subagentOutputs(fixture);
    expect(outputs.map(event => event.tool_call_id)).toEqual(['call-beta', 'call-alpha']);
    const root = outputs[0]?.run_id;
    if (!root) throw new Error('Missing root run');
    for (const [callId, description] of [['call-alpha', 'Alpha'], ['call-beta', 'Beta']] as const) {
      const output = outputs.find(event => event.tool_call_id === callId);
      if (!output) throw new Error(`Missing ${callId}`);
      expect(output.status).toBe('success');
      const result = SubagentResultSchema.parse({ data: output.data, observation: output.observation });
      expect(result.data).toMatchObject({
        description,
        status: 'completed',
        final_answer: answerOf(description),
      });
      const subrunId = result.data.subrun_ids[0];
      if (!subrunId) throw new Error('Missing subrun id');
      const trace = readSubrunTrace(fixture.db, conversationId, callId, subrunId);
      if (trace.status !== 'ready') throw new Error(`Missing trace of ${callId}`);
      expect(JSON.stringify(trace.events)).toContain(answerOf(description));
      expect(JSON.stringify(trace.events)).not.toContain(
        answerOf(description === 'Alpha' ? 'Beta' : 'Alpha')
      );
    }
    const children = await childRunsOf(fixture, root);
    // 完成后恢复描述随终态回收；父调用归属已由上面按 parentToolCallId 读到的 trace 证明。
    expect(children.map(child => child.run.status)).toEqual(['completed', 'completed']);

    // Linnkit 把完成顺序（Beta 先）排回调用顺序后才交给模型。
    expect(rootFinal?.messages.filter(m => m.role === 'tool').map(m => m.tool_call_id)).toEqual([
      'call-alpha',
      'call-beta',
    ]);
    const window = readTail(fixture.db, conversationId, 100);
    if (window.status !== 'ready') throw new Error('Missing reload projection');
    const cards = window.messages.filter(message => message.message_type === 'tool_calls');
    expect(cards).toHaveLength(2);
    expect(cards.every(card => card.payload.status === 'success')).toBe(true);
    expect((await fixture.flow.getActiveForegroundRun(conversationId)).run).toBeNull();
  });

  it('与不可并行工具混排时，屏障前的组先全部结束，屏障之后的调用再开始', async () => {
    const descriptions = ['Alpha', 'Beta', 'Gamma'];
    const fixture = await open(async (call): Promise<ScriptedLlmTurn> => {
      const route = classify(call, descriptions);
      if (route.kind === 'root') {
        return route.toolResults.length === 0
          ? {
              toolCalls: [
                subagentCall('call-alpha', 'Alpha'),
                subagentCall('call-beta', 'Beta'),
                { id: 'call-serial', name: SERIAL_TOOL, arguments: {} },
                subagentCall('call-gamma', 'Gamma'),
              ],
            }
          : { contentChunks: ['Mixed batch finished.'] };
      }
      return { contentChunks: [answerOf(route.description)] };
    });
    const projectId = await project(fixture);
    const together = createRendezvous(['call-alpha', 'call-beta']);
    const tool = new ObservedSubagentTool(callId =>
      callId === 'call-gamma' ? Promise.resolve() : together.arrive(callId)
    );
    installTools([tool, new SerialMarkerTool(tool.timeline)]);

    await fixture.flow.next(request(projectId), () => {});

    const timeline = tool.timeline;
    const serialStart = position(timeline, 'call-serial', 'start');
    expect(position(timeline, 'call-alpha', 'end')).toBeLessThan(serialStart);
    expect(position(timeline, 'call-beta', 'end')).toBeLessThan(serialStart);
    expect(position(timeline, 'call-serial', 'end')).toBeLessThan(
      position(timeline, 'call-gamma', 'start')
    );
    const outputs = await toolOutputs(fixture);
    expect(outputs.map(event => event.tool_call_id).slice(2)).toEqual(['call-serial', 'call-gamma']);
    expect(outputs.every(event => event.status === 'success')).toBe(true);
  });

  it('用户取消传到两个在跑的子运行，每个调用都有配对结果，重开后没有 loading 行', async () => {
    const descriptions = ['Alpha', 'Beta'];
    const childrenTogether = createRendezvous(descriptions);
    let cancelled!: () => void;
    const afterCancel = new Promise<void>(resolve => {
      cancelled = resolve;
    });
    const fixture = await open(async (call): Promise<ScriptedLlmTurn> => {
      const route = classify(call, descriptions);
      if (route.kind === 'root') {
        return { toolCalls: [subagentCall('call-alpha', 'Alpha'), subagentCall('call-beta', 'Beta')] };
      }
      await childrenTogether.arrive(route.description);
      // 两个 child 都在模型调用里时用户取消；Provider 随后以中止结束这次请求。
      await afterCancel;
      return { failure: { kind: 'aborted', code: 'aborted', retryable: false } };
    });
    const projectId = await project(fixture);
    const tool = new ObservedSubagentTool();
    installTools([tool]);

    const running = fixture.flow.next(request(projectId), () => {});
    await vi.waitFor(async () => {
      const root = (await fixture.flow.getActiveForegroundRun(conversationId)).run;
      if (!root) throw new Error('Root not running yet');
      expect((await childRunsOf(fixture, root.run_id)).length).toBe(2);
    });
    const root = (await fixture.flow.getActiveForegroundRun(conversationId)).run;
    if (!root) throw new Error('Missing running root');
    const cancelling = fixture.flow.cancelRun(root.run_id, conversationId, 'fixture user cancellation');
    await vi.waitFor(() => expect(tool.abortedCalls.size).toBe(2));
    cancelled();
    await cancelling;
    await running;

    expect([...tool.abortedCalls].sort()).toEqual(['call-alpha', 'call-beta']);
    const children = await childRunsOf(fixture, root.run_id);
    expect(children.map(child => child.run.status)).toEqual(['cancelled', 'cancelled']);
    expect((await fixture.runtime.supervisor.peek(RunIdSchema.parse(root.run_id)))?.status).toBe(
      'cancelled'
    );
    const outputs = await subagentOutputs(fixture);
    expect(outputs.map(event => event.tool_call_id).sort()).toEqual(['call-alpha', 'call-beta']);

    await close(fixture);
    const reloaded = await open([]);
    const window = readTail(reloaded.db, conversationId, 100);
    if (window.status !== 'ready') throw new Error('Missing reload projection');
    const cards = window.messages.filter(message => message.message_type === 'tool_calls');
    expect(cards).toHaveLength(2);
    expect(cards.some(card => card.payload.status === 'loading')).toBe(false);
    expect((await reloaded.flow.getActiveForegroundRun(conversationId)).run).toBeNull();
  });

  it('一个子任务中断时保留已完成同伴，继续后只补未完成的那个', async () => {
    const descriptions = ['Alpha', 'Beta'];
    const childCalls: string[] = [];
    let alphaCompleted!: () => void;
    const alphaDone = new Promise<void>(resolve => {
      alphaCompleted = resolve;
    });
    const first = await open(async (call): Promise<ScriptedLlmTurn> => {
      const route = classify(call, descriptions);
      if (route.kind === 'root') {
        return { toolCalls: [subagentCall('call-alpha', 'Alpha'), subagentCall('call-beta', 'Beta')] };
      }
      childCalls.push(route.description);
      if (route.description === 'Alpha') return { contentChunks: [answerOf('Alpha')] };
      // Beta 在同伴完成后才因传输错误中断，证明中断不影响已完成同伴的提交。
      await alphaDone;
      return { throwAfterEvents: new Error('Synthetic Beta transport interruption') };
    });
    const projectId = await project(first);
    installTools([
      new ObservedSubagentTool(undefined, async callId => {
        if (callId === 'call-alpha') alphaCompleted();
      }),
    ]);
    await first.flow.next(request(projectId), () => {});

    const root = await pausedRoot(first);
    const children = await childRunsOf(first, root.run_id);
    const alphaChild = children.find(child => child.parentToolCallId === 'call-alpha');
    const betaChild = children.find(child => child.parentToolCallId === 'call-beta');
    expect(alphaChild?.run.status).toBe('completed');
    expect(betaChild?.run.status).toBe('paused');
    // 已完成的 Alpha 结果在暂停前提交；Beta 仍是在途调用，没有结果。
    expect((await subagentOutputs(first)).map(event => event.tool_call_id)).toEqual(['call-alpha']);
    const alphaFacts = (await facts(first)).filter(event => event.run_id === alphaChild?.run.runId);
    await close(first);

    const resumedCalls: string[] = [];
    const resumed = await open(async (call): Promise<ScriptedLlmTurn> => {
      const route = classify(call, descriptions);
      if (route.kind === 'root') return { contentChunks: ['Both subtasks finished after resume.'] };
      resumedCalls.push(route.description);
      return { contentChunks: [answerOf(route.description)] };
    });
    const resumedTool = new ObservedSubagentTool();
    installTools([resumedTool]);
    // 重开后启动恢复可能刷新暂停记录，按新进程读到的暂停边界继续。
    const reopenedRoot = await pausedRoot(resumed);
    await resumed.flow.continueRun(
      reopenedRoot.run_id,
      {
        conversation_id: conversationId,
        expected_execution_id: reopenedRoot.execution_id,
        expected_updated_at: reopenedRoot.pause.updated_at,
      },
      () => {}
    );

    expect(childCalls).toEqual(expect.arrayContaining(['Alpha', 'Beta']));
    expect(resumedCalls).toEqual(['Beta']);
    // 只对账在途的 Beta；Alpha 已结算，不再进入工具。
    expect(resumedTool.timeline.map(entry => entry.call)).toEqual(['call-beta', 'call-beta']);
    expect((await facts(resumed)).filter(event => event.run_id === alphaChild?.run.runId)).toEqual(
      alphaFacts
    );
    const outputs = await subagentOutputs(resumed);
    expect(outputs.map(event => event.tool_call_id)).toEqual(['call-alpha', 'call-beta']);
    for (const output of outputs) {
      const description = output.tool_call_id === 'call-alpha' ? 'Alpha' : 'Beta';
      expect(
        SubagentResultSchema.parse({ data: output.data, observation: output.observation }).data
          .final_answer
      ).toBe(answerOf(description));
    }
    expect(
      (await childRunsOf(resumed, root.run_id)).map(child => child.run.status)
    ).toEqual(['completed', 'completed']);
    expect((await resumed.flow.getActiveForegroundRun(conversationId)).run).toBeNull();
  });
});
