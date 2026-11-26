// @vitest-environment jsdom

import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { createApp, defineComponent, h, nextTick, shallowRef, type App, type ComputedRef } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConversationExecutionNoticeMetadataSchema,
  ConversationThoughtMessageMetadataSchema,
} from '@app/schemas';
import type { BaseMessage, ThoughtMessage, ToolCallMessage } from '../../../types';
import { useInteractiveRunStore, type InteractiveRunStatus } from '../../../features/interactive-run';
import {
  createTestAnswerMessage,
  createTestSummarizationProgressMessage,
  createTestToolMessage,
  createTestUserMessage,
} from '../../../testing/functions/createConversationTestMessage';
import type { RunStatusRowView } from '../definitions/runStatus';
import { useRunStatusRow } from '../composables/useRunStatusRow';
import { resolveRunStatusSignal, resolveRunStatusText } from '../functions/resolveRunStatus';

const CONVERSATION_ID = 'conv-status';
const RUN_ID = 'run-status';
const T0 = Date.parse('2026-11-26T08:00:00.000Z');

/** 测试里用工具名代表 owner 声明；真实接线读 ToolUiConfig.activity。 */
function testToolActivity(message: ToolCallMessage) {
  return message.metadata.tool_name === 'web_search' ? 'search' as const : undefined;
}

function thought(id: string, startedAt: number, complete: boolean): ThoughtMessage {
  return {
    id,
    role: 'assistant',
    type: 'thought',
    content: '想一想',
    timestamp: startedAt,
    metadata: ConversationThoughtMessageMetadataSchema.parse(complete
      ? { turn_id: 't', run_id: RUN_ID, is_complete: true, thought_started_at: startedAt, thought_completed_at: startedAt + 1 }
      : { turn_id: 't', run_id: RUN_ID, is_complete: false, thought_started_at: startedAt }),
  };
}

function tool(id: string, name: string, status: 'loading' | 'success', at: number): ToolCallMessage {
  return createTestToolMessage({ id, timestamp: at, metadata: { tool_name: name, status, run_id: RUN_ID } });
}

describe('底部运行状态行', () => {
  let app: App<Element> | undefined;
  let pinia: Pinia;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 2_000);
    pinia = createPinia();
    setActivePinia(pinia);
  });

  afterEach(() => {
    app?.unmount();
    app = undefined;
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  function mount(initial: readonly BaseMessage[]) {
    const messages = shallowRef<readonly BaseMessage[]>(initial);
    const holder: { row?: ComputedRef<RunStatusRowView | null> } = {};
    app = createApp(defineComponent({
      setup() {
        holder.row = useRunStatusRow({
          conversationId: () => CONVERSATION_ID,
          messages: () => messages.value,
          resolveToolActivity: testToolActivity,
        });
        return () => h('div');
      },
    }));
    app.use(pinia);
    app.mount(document.createElement('div'));
    const read = (): RunStatusRowView | null => {
      if (!holder.row) throw new Error('status row did not mount');
      return holder.row.value;
    };
    return { messages, read };
  }

  function setRun(status: InteractiveRunStatus): void {
    useInteractiveRunStore().synchronizeSnapshot(CONVERSATION_ID, {
      conversationId: CONVERSATION_ID,
      runId: RUN_ID,
      executionId: 'exec-1',
      status,
    });
  }

  async function advance(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await nextTick();
  }

  it('整轮跟着真实进展换文字，每条至少停留 2 秒，暂停时停表并静止，结束后消失', async () => {
    const user = createTestUserMessage({ id: 'u1', timestamp: T0, metadata: { run_id: RUN_ID } });
    setRun('running');
    const { messages, read } = mount([user]);
    await nextTick();
    // 从用户消息算起：挂载时已过去 2 秒。
    expect(read()).toEqual({ text: '正在分析问题', elapsedText: '2秒', motion: 'sway' });

    // 思考马上开始，但“正在分析问题”还没停够 2 秒，不能一闪而过。
    messages.value = [user, thought('th1', T0 + 2_000, false)];
    await nextTick();
    expect(read()?.text).toBe('正在分析问题');
    await advance(2_000);
    expect(read()?.text).toBe('正在思考');

    // 同一段思考超过 30 秒。
    await advance(29_000);
    expect(read()?.text).toBe('苦思冥想中');
    expect(read()?.elapsedText).toBe('33秒');

    // 思考结束、开始联网搜索：工具 owner 声明的类别决定文字。
    messages.value = [user, thought('th1', T0 + 2_000, true), tool('s1', 'web_search', 'loading', T0 + 33_000)];
    await advance(1_000);
    expect(read()).toMatchObject({ text: '正在查找', motion: 'sway' });

    // 搜索返回、模型还没给出下一步。
    messages.value = [user, thought('th1', T0 + 2_000, true), tool('s1', 'web_search', 'success', T0 + 33_000)];
    await advance(2_000);
    expect(read()?.text).toBe('正在分析结果');
    expect(read()?.elapsedText).toBe('36秒');

    // 用户暂停：立刻显示（不等停留时间），图标静止，计时停住。
    setRun('paused');
    await nextTick();
    expect(read()).toEqual({ text: '已暂停', elapsedText: '36秒', motion: 'still' });
    await advance(60_000);
    expect(read()?.elapsedText).toBe('36秒');

    // 继续后接着计时，不把暂停的一分钟算进去。
    setRun('running');
    await advance(4_000);
    expect(read()?.text).toBe('正在分析结果');
    expect(read()?.elapsedText).toBe('40秒');

    setRun('completed');
    await nextTick();
    expect(read()).toBeNull();
  });

  it('没有声明类别的工具说“努力工作中”，回答流式时说“正在写回答”', async () => {
    const user = createTestUserMessage({ id: 'u1', timestamp: T0, metadata: { run_id: RUN_ID } });
    setRun('running');
    const { messages, read } = mount([user, tool('x1', 'some_plugin_tool', 'loading', T0 + 1_000)]);
    await nextTick();
    expect(read()?.text).toBe('努力工作中');

    messages.value = [
      user,
      tool('x1', 'some_plugin_tool', 'success', T0 + 1_000),
      createTestAnswerMessage({ id: 'a1', metadata: { run_id: RUN_ID, is_complete: false } }),
    ];
    await advance(2_000);
    expect(read()).toMatchObject({ text: '正在写回答', motion: 'sway' });
  });
});

describe('运行状态信号的优先级', () => {
  const now = T0 + 10_000;
  const base = {
    runStatus: 'running' as const,
    executionId: 'exec-1',
    awaitingApproval: false,
    now,
    resolveToolActivity: testToolActivity,
  };
  const text = (input: Parameters<typeof resolveRunStatusSignal>[0]) => (
    resolveRunStatusText(resolveRunStatusSignal(input)).labelKey
  );

  it('球在用户这边时优先说明：等回答、等批准命令', () => {
    const loading = [tool('s1', 'web_search', 'loading', T0)];
    expect(text({ ...base, runStatus: 'awaiting_user', runMessages: loading })).toBe('conversation.runStatus.awaitingAnswer');
    expect(text({ ...base, awaitingApproval: true, runMessages: loading })).toBe('conversation.runStatus.awaitingApproval');
    expect(text({ ...base, runStatus: 'pausing', runMessages: loading })).toBe('conversation.runStatus.paused');
  });

  it('上下文摘要进行中说“正在整理上下文”；只有本次执行的重试才说“网络不稳，正在重试”', () => {
    expect(text({ ...base, runMessages: [createTestSummarizationProgressMessage()] }))
      .toBe('conversation.runStatus.compacting');

    const notice = (executionId: string): BaseMessage => ({
      id: `notice-${executionId}`,
      role: 'system',
      type: 'execution_notice',
      content: '',
      timestamp: T0,
      metadata: ConversationExecutionNoticeMetadataSchema.parse({
        turn_id: 't',
        run_id: RUN_ID,
        execution_id: executionId,
        retry: {
          retry_id: 'r1', status: 'waiting', category: 'transport', attempt: 1,
          max_retries: 3, total_attempts: 1, started_at: T0, updated_at: T0,
        },
      }),
    });
    expect(text({ ...base, runMessages: [notice('exec-1')] })).toBe('conversation.runStatus.retrying');
    // 暂停后继续是新的执行；旧执行留下的重试通知不能让状态行一直说在重试。
    expect(text({ ...base, runMessages: [notice('exec-old')] })).toBe('conversation.runStatus.working');
  });

  it('并行工具里还有在跑的就说它在做什么，全部返回才说“正在分析结果”', () => {
    const searching = tool('s1', 'web_search', 'loading', T0);
    const done = tool('o1', 'other_tool', 'success', T0 + 1);
    expect(text({ ...base, runMessages: [searching, done] })).toBe('conversation.runStatus.search');
    expect(text({ ...base, runMessages: [tool('s1', 'web_search', 'success', T0), done] }))
      .toBe('conversation.runStatus.reviewingResults');
  });
});
