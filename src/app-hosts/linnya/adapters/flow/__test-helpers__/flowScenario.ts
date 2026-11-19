import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConversationInteractionResponseRequest, ConversationNextRequest } from '@app/schemas';
import { createPinia, setActivePinia } from 'pinia';
import { RunIdSchema, type RuntimeEvent, type SSEEvent } from '@linnlabs/linnkit/contracts';
import {
  assertSteeringInvariants,
  formatRuntimeTimeline,
  validateRunInvariants,
  type RunInvariantId,
  type ScriptedInferenceScript,
  type ScriptedLlmCall,
  type TimelineOptions,
  type ValidateSteeringInvariantsOptions,
} from '@linnlabs/linnkit/testkit';
import { BaseTool, type ToolContext, type ToolParameterSchema } from 'src/tools/types';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
import { enableConsoleLogging } from 'src/shared/logger';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from '../../../plugin-registry/pluginRuntimeState';
import { readTail } from '../../persistence/event-store/ui-projection/sqliteUiMessagesReader';
import type { ConversationRealtimeEvent } from '../flow.schemas';
import { createDurableFlowHarness, installRecoveryModelFixture } from './createDurableFlowHarness';
import type { RecordedRealModelInference } from './realModelInference';
import {
  createInitialProjectionState,
  reduceEvent,
} from '../../../../../../apps/renderer/domains/conversation/services/messageProjection';
import { mapUiMessageDtoToConversationMessage } from '../../../../../../apps/renderer/domains/conversation/message-window/functions/mapUiMessageDto';
import type { BaseMessage } from '../../../../../../apps/renderer/domains/conversation/types';

/** 工具脚本的返回：字符串即 observation；`{ error }` 让工具以执行错误结束（Linnya 工具以抛错报告失败）。 */
export type FlowScenarioToolOutcome =
  | string
  | { readonly observation?: string; readonly data?: Record<string, unknown>; readonly error?: string };

export interface FlowScenarioToolInvocation {
  readonly args: Record<string, unknown>;
  readonly context: ToolContext;
  /** 该工具第几次被执行（从 1 开始）。 */
  readonly count: number;
}

export type FlowScenarioToolHandler = (
  invocation: FlowScenarioToolInvocation,
) => FlowScenarioToolOutcome | Promise<FlowScenarioToolOutcome>;

export interface FlowScenarioToolSpec {
  readonly run?: FlowScenarioToolHandler;
  readonly description?: string;
  readonly parameters?: ToolParameterSchema;
}

export interface FlowScenarioOptions {
  /**
   * 脚本模型：回合表或按请求决定回合的函数（Linnkit testkit 同一套脚本）。
   * 也可以传 `createRecordedRealModelInference()`，用开发实例配置好的真实模型（见 realModelInference.ts）。
   */
  model: ScriptedInferenceScript | RecordedRealModelInference;
  /** 按名字写工具脚本，经 Linnya 真实的 ToolManager 执行。 */
  tools?: Readonly<Record<string, FlowScenarioToolHandler | FlowScenarioToolSpec>>;
  /** 原样接入的产品工具（如 `ask`），用来走真实的等待用户、表单等流程。 */
  productTools?: readonly BaseTool[];
  conversationId?: string;
}

export type FlowScenarioStatus = 'completed' | 'failed' | 'cancelled' | 'paused' | 'awaiting_user' | 'unknown';

export interface FlowScenarioRun {
  readonly runId: string;
  readonly status: FlowScenarioStatus;
  /** status=paused 时的原因：`user_pause`，或模型 / 工具失败后可继续的分类错误码。 */
  readonly pauseReason?: string;
  /** 运行停下后 Renderer 会取回的、没送达的插话原文（按提交顺序）。 */
  readonly undeliveredSteers: readonly string[];
}

export interface FlowScenario {
  readonly conversationId: string;
  readonly fixture: Awaited<ReturnType<typeof createDurableFlowHarness>>;
  /** 这段会话里客户端收到的全部实时事件。 */
  readonly realtime: ConversationRealtimeEvent[];
  /** 发一条用户消息并等这次运行停下（完成、失败、暂停、取消或等待用户）。 */
  send(text: string): Promise<FlowScenarioRun>;
  /** 从最近一次暂停继续，并等运行停下。 */
  continue(): Promise<FlowScenarioRun>;
  /** 回答当前运行正在等的交互（默认 `ask`），并等运行停下。 */
  respond(
    observation: string,
    options?: { toolName?: string; data?: ConversationInteractionResponseRequest['data'] },
  ): Promise<FlowScenarioRun>;
  /** 给正在运行的前台运行插话；没有运行时返回 accepted=false（客户端会改发新消息）。 */
  steer(text: string, options?: { id?: string }): Promise<{ accepted: boolean; inputId: string }>;
  /** 撤回一条还没送达的插话。 */
  withdraw(inputId: string): Promise<string>;
  /**
   * 请求暂停当前运行。可以在工具或模型脚本里调用：返回的 Promise 在暂停请求被接受（运行信号已中止）时完成，
   * 不等运行停下——运行收口由 `send` / `continue` 一并等待。
   */
  pause(): Promise<void>;
  /** 请求取消当前运行；与 `pause()` 一样只等到取消请求被接受。 */
  cancel(): Promise<void>;
  history(): Promise<RuntimeEvent[]>;
  timeline(options?: TimelineOptions): Promise<string[]>;
  modelCalls(): ScriptedLlmCall[];
  /** 客户端按实时事件投影出的消息（Renderer 真实投影代码）。 */
  liveMessages(): BaseMessage[];
  /** 重新打开会话时从持久窗口读到的消息（Renderer 真实映射代码）。 */
  reloadedMessages(): BaseMessage[];
  /**
   * 检查跨层不变量，失败时附上时间线：
   * - H1 实时投影与重载结果一致（不含运行起点输入，它由客户端自己先显示）；
   * - H2 每条被接纳的插话恰好一个去向：送达、运行停下时取回、或被撤回；
   * - S1–S5 Linnkit 插话不变量（按模型实际收到的消息判断）；
   * - 已停下的根运行满足 Linnkit 运行不变量（终态、工具调用配对、事件运行身份、无旧协议事件、等待用户联动）。
   */
  assertInvariants(options?: ValidateSteeringInvariantsOptions): Promise<void>;
  close(): Promise<void>;
}

function toolResult(outcome: FlowScenarioToolOutcome, name: string): string {
  if (typeof outcome === 'string') return JSON.stringify({ observation: outcome, data: {} });
  if (outcome.error !== undefined) throw new Error(outcome.error);
  return JSON.stringify({ observation: outcome.observation ?? `${name} done`, data: outcome.data ?? {} });
}

class ScriptedFlowTool extends BaseTool {
  readonly parameters: ToolParameterSchema;
  readonly description: string;
  private count = 0;

  constructor(readonly name: string, private readonly spec: FlowScenarioToolSpec) {
    super();
    this.description = spec.description ?? `scripted tool ${name}`;
    this.parameters = spec.parameters ?? { type: 'object', properties: {} };
  }

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    this.count += 1;
    const outcome = this.spec.run ? await this.spec.run({ args, context, count: this.count }) : `${this.name} done`;
    return toolResult(outcome, this.name);
  }
}

/**
 * 只比较两边都应一致的业务字段：消息类型、正文、插话标记、工具调用与状态。
 * 未封口的回答（chunk 流还没被持久 final_answer 封口）不参与：终态时 Renderer 会按持久窗口校正它。
 */
function comparable(messages: readonly BaseMessage[]): string[] {
  return messages.flatMap(message => {
    switch (message.type) {
      case 'user_input':
        return message.metadata?.delivery === 'mid_run' ? [`steer ${JSON.stringify(message.content)}`] : [];
      case 'tool_calls':
        return [`tool ${message.metadata.tool_call_id ?? ''} ${message.metadata.status ?? ''}`];
      case 'final_answer':
        return message.metadata.completion_reason === undefined ? [] : [`answer ${JSON.stringify(message.content)}`];
      default:
        return [];
    }
  });
}

/** 生产装配下能取到证据的运行不变量。审计只在开发模式开启、生产打包装配下关闭，审计类不变量由 Linnkit 端到端测试覆盖。 */
const RUN_INVARIANTS: readonly RunInvariantId[] = [
  'I1_FINAL_STATUS',
  'I3_TOOL_CALL_OUTPUT_PAIR',
  'I6_EVENT_RUN_IDENTITY',
  'I8_NO_ACTION_EVENT',
  'I10_TELEMETRY_RUN_REGISTERED',
  'I13_WAIT_USER_STATUS',
];

function isSse(event: ConversationRealtimeEvent): event is SSEEvent {
  return event.type !== 'user_input_committed';
}

/**
 * Flow 层场景：真 SQLite、生产 Runtime 启动装配、Graph、Flow 编排与插话登记表，只替换上游模型和工具。
 *
 * 读数同时覆盖四层：持久历史、实时事件、客户端实时投影、重载后的消息窗口。
 */
export async function createFlowScenario(options: FlowScenarioOptions): Promise<FlowScenario> {
  const conversationId = options.conversationId ?? 'conv_flow_scenario';
  const directory = mkdtempSync(join(tmpdir(), 'linnya-flow-scenario-'));
  setPluginRuntimeStateForTests({ installedPluginIds: ['platform'], enabledPluginIds: ['platform'] });
  const realModel = typeof options.model === 'object' && 'usesProductionCatalog' in options.model
    ? options.model
    : undefined;
  const modelId = realModel?.modelId ?? 'scripted-test-model';
  const restoreModelCatalog = realModel ? () => undefined : installRecoveryModelFixture();
  // 实时投影与 Renderer 同一套 reducer；错误通知等分支会读 Pinia store，每个场景独立一份。
  setActivePinia(createPinia());
  // `pnpm -s scenario` 默认只看用例结果；直接跑 vitest 或 --verbose 时保留 Runtime 日志。
  if (process.env.SCENARIO_QUIET === '1') enableConsoleLogging(false);
  const tools = [
    ...Object.entries(options.tools ?? {}).map(([name, entry]) =>
      new ScriptedFlowTool(name, typeof entry === 'function' ? { run: entry } : entry)),
    ...(options.productTools ?? []),
  ];
  // 模型只看到、也只能执行场景声明的工具，与脚本还是真实模型无关。
  const fixture = await createDurableFlowHarness(
    join(directory, 'workspace.sqlite'), options.model, tools, true, undefined, 'only-injected',
  );
  const realtime: ConversationRealtimeEvent[] = [];
  const live = createInitialProjectionState({
    id: conversationId,
    title: 'scenario',
    titleOrigin: 'explicit',
    createdAt: 1,
    updatedAt: 1,
    selectedAgentId: null,
    messages: [],
  });
  const liveErrors: string[] = [];
  const acceptedSteers = new Map<string, string>();
  const withdrawnSteers = new Set<string>();
  const returnedSteers: string[] = [];
  const pendingControls: Promise<unknown>[] = [];
  let sendCount = 0;
  let steerCount = 0;
  let lastRunId: string | undefined;

  const onRealtime = (event: ConversationRealtimeEvent) => {
    realtime.push(event);
    if (!isSse(event)) return;
    const result = reduceEvent(live, event);
    if (!result.success) liveErrors.push(`${event.type}: ${result.reason ?? 'rejected'}`);
  };

  async function activeRun() {
    return (await fixture.flow.getActiveForegroundRun(conversationId)).run;
  }

  async function rootRunIds(): Promise<string[]> {
    return (await fixture.runtime.supervisor.findByConversation(conversationId))
      .filter(run => !run.parentRunId)
      .map(run => run.runId);
  }

  async function settle(runId: string | undefined): Promise<FlowScenarioRun> {
    await Promise.allSettled(pendingControls.splice(0));
    if (!runId) throw new Error('[flowScenario] 没找到这次运行');
    const id = runId;
    lastRunId = id;
    const record = await fixture.runtime.supervisor.peek(RunIdSchema.parse(id));
    const status: FlowScenarioStatus = record?.status === 'completed' || record?.status === 'failed'
      || record?.status === 'cancelled' || record?.status === 'paused' || record?.status === 'awaiting_user'
      ? record.status
      : 'unknown';
    // 与 Renderer 一致：运行停下后取回没送达的插话；等待用户时运行还在，插话继续等送达。
    const drained = status === 'awaiting_user' ? [] : fixture.flow.drainSteers(id, conversationId).inputs;
    for (const input of drained) returnedSteers.push(input.input_id);
    return {
      runId: id,
      status,
      ...(status === 'paused' && record?.pauseReason ? { pauseReason: record.pauseReason } : {}),
      undeliveredSteers: drained.map(input => input.content),
    };
  }

  /**
   * 发出暂停 / 取消并等到 Supervisor 接受（先落盘状态再中止信号）。控制操作本身会等运行收口，
   * 在工具或模型脚本里等它会自锁，所以交给 `send` / `continue` 一并等待。
   */
  function requestControl(
    label: string,
    accepted: 'paused' | 'cancelled',
    control: (run: NonNullable<Awaited<ReturnType<typeof activeRun>>>) => Promise<unknown>,
  ): Promise<void> {
    const request = (async () => {
      const run = await activeRun();
      if (!run) throw new Error(`[flowScenario] 当前没有运行可以${label}`);
      pendingControls.push(control(run));
      const id = RunIdSchema.parse(run.run_id);
      for (let attempt = 0; attempt < 500; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
        if ((await fixture.runtime.supervisor.peek(id))?.status === accepted) return;
      }
      throw new Error(`[flowScenario] ${label}请求没有被接受`);
    })();
    pendingControls.push(request);
    return request;
  }

  async function history(): Promise<RuntimeEvent[]> {
    return (await fixture.eventStore.readEvents(conversationId, { limit: 10_000 })).events;
  }

  function reloadedMessages(): BaseMessage[] {
    const window = readTail(fixture.db, conversationId, 1_000);
    if (window.status !== 'ready') throw new Error(`[flowScenario] 消息窗口未就绪：${window.status}`);
    return window.messages.map(message => mapUiMessageDtoToConversationMessage(message));
  }

  return {
    conversationId,
    fixture,
    realtime,

    async send(text) {
      sendCount += 1;
      const request: ConversationNextRequest = {
        conversation_id: conversationId,
        new_events: [{ type: 'user_input', content: text, timestamp: Date.now() + sendCount, source: 'user' }],
        options: { promptKey: 'default', model_id: modelId },
      };
      const before = new Set(await rootRunIds());
      await fixture.flow.next(request, onRealtime);
      const created = (await rootRunIds()).filter(id => !before.has(id));
      return settle(created[created.length - 1]);
    },

    async continue() {
      const run = await activeRun();
      if (!run?.pause || !run.execution_id) throw new Error('[flowScenario] 没有暂停中的运行可以继续');
      await fixture.flow.continueRun(run.run_id, {
        conversation_id: conversationId,
        expected_execution_id: run.execution_id,
        expected_updated_at: run.pause.updated_at,
      }, onRealtime);
      return settle(run.run_id);
    },

    async respond(observation, respondOptions = {}) {
      const run = await activeRun();
      const interaction = run?.pending_interaction;
      if (!run || !interaction) throw new Error('[flowScenario] 当前运行没有等待中的交互');
      await fixture.flow.respondInteraction({
        conversation_id: conversationId,
        ...interaction,
        tool_name: respondOptions.toolName ?? 'ask',
        observation,
        data: respondOptions.data ?? {},
        interaction_status: 'submitted',
        interaction_submitted_at: Date.now(),
      }, onRealtime);
      return settle(run.run_id);
    },

    async steer(text, steerOptions = {}) {
      steerCount += 1;
      const inputId = steerOptions.id ?? `evt_steer_${steerCount}`;
      const run = await activeRun();
      if (!run) return { accepted: false, inputId };
      const response = await fixture.flow.steerRun(run.run_id, {
        conversation_id: conversationId,
        input_id: inputId,
        content: text,
      });
      if (response.accepted) acceptedSteers.set(inputId, text);
      return { accepted: response.accepted, inputId };
    },

    async withdraw(inputId) {
      const runId = (await activeRun())?.run_id ?? lastRunId;
      if (!runId) return 'not_found';
      const { outcome } = fixture.flow.withdrawSteer(runId, conversationId, inputId);
      if (outcome === 'withdrawn') withdrawnSteers.add(inputId);
      return outcome;
    },

    pause() {
      return requestControl('暂停', 'paused', run => {
        if (!run.execution_id) throw new Error('[flowScenario] 当前运行没有执行身份，不能暂停');
        return fixture.flow.pauseRun(run.run_id, conversationId, run.execution_id);
      });
    },

    cancel() {
      return requestControl('取消', 'cancelled', run => fixture.flow.cancelRun(run.run_id, conversationId, 'scenario cancel'));
    },

    history,
    timeline: async timelineOptions => formatRuntimeTimeline(await history(), timelineOptions),
    modelCalls: () => fixture.ai.getCalls(),
    liveMessages: () => live.conversation.messages,
    reloadedMessages,

    async assertInvariants(invariantOptions) {
      const events = await history();
      const failures: string[] = [...liveErrors.map(error => `H1 实时事件投影失败：${error}`)];
      const liveView = comparable(live.conversation.messages);
      const reloadView = comparable(reloadedMessages());
      if (JSON.stringify(liveView) !== JSON.stringify(reloadView)) {
        failures.push(`H1 实时投影与重载不一致：\n  实时 ${JSON.stringify(liveView)}\n  重载 ${JSON.stringify(reloadView)}`);
      }
      const delivered = new Set(events.filter(event => event.type === 'user_input' && event.delivery === 'mid_run')
        .map(event => event.id));
      for (const [inputId, text] of acceptedSteers) {
        const outcomes = Number(delivered.has(inputId)) + Number(withdrawnSteers.has(inputId))
          + returnedSteers.filter(id => id === inputId).length;
        if (outcomes !== 1) failures.push(`H2 插话 ${inputId}（${text}）有 ${outcomes} 个去向，应恰好 1 个`);
      }
      try {
        assertSteeringInvariants({ history: events, modelCalls: fixture.ai.getCalls() }, invariantOptions);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
      const records = await fixture.runtime.supervisor.findByConversation(conversationId);
      for (const root of records.filter(record => !record.parentRunId && record.status !== 'paused')) {
        const report = await validateRunInvariants({
          rootRunId: root.runId,
          runRecords: records,
          events,
          telemetryEvents: fixture.telemetryEvents,
        }, { enabled: RUN_INVARIANTS });
        for (const failure of report.failures) failures.push(`${failure.id} ${failure.title}：${failure.message}`);
      }
      if (failures.length > 0) {
        const timeline = formatRuntimeTimeline(events).map(line => `  ${line}`).join('\n');
        throw new Error(`[flowScenario]\n${failures.join('\n')}\n时间线：\n${timeline}`);
      }
    },

    async close() {
      // Workspace 变更通知在下一个 macrotask 读取提交结果，关闭数据库前让 owner 完成发布。
      await new Promise(resolve => setTimeout(resolve, 0));
      fixture.close();
      resetAgentRuntimeSingletonsForTest();
      clearPluginRuntimeStateForTests();
      restoreModelCatalog();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
