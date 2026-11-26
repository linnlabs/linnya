// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia';
import { createApp, defineComponent, h, nextTick, shallowRef, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TaskState } from '@app/schemas';
import type { BaseMessage, ToolCallMessage } from '../../../types';
import { useInteractiveRunStore, type InteractiveRunStatus } from '../../interactive-run';
import { createTestToolMessage } from '../../../testing/functions/createConversationTestMessage';
import { RunTaskProgressTray, useRunTaskProgress } from '..';

const CONVERSATION_ID = 'conv-task';
const RUN_ID = 'run-task';

function taskState(phase: TaskState['current_phase'], next: string): TaskState {
  return {
    goal: '对比三家公司 2025 年储能电池出货量，写成一份文档',
    constraints: [],
    current_phase: phase,
    current_plan: ['查年报', '交叉核对排名', '写入文档'],
    progress: '已查完年报',
    next_steps: [next, '对照口径差异'],
    references: ['https://example.com/report'],
  };
}

function taskWrite(id: string, state: TaskState, runId = RUN_ID, toolName = 'task_write'): ToolCallMessage {
  return createTestToolMessage({
    id,
    metadata: { tool_name: toolName, run_id: runId, data: { operation: 'update', version: 2, taskstate: state } },
  });
}

describe('输入框上方的任务进度', () => {
  let app: App<Element> | undefined;

  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => {
    app?.unmount();
    app = undefined;
    document.body.innerHTML = '';
  });

  function setRun(status: InteractiveRunStatus): void {
    useInteractiveRunStore().synchronizeSnapshot(CONVERSATION_ID, {
      conversationId: CONVERSATION_ID, runId: RUN_ID, status,
    });
  }

  function mount(initial: readonly BaseMessage[]) {
    const messages = shallowRef<readonly BaseMessage[]>(initial);
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp(defineComponent({
      setup() {
        const progress = useRunTaskProgress({
          conversationId: () => CONVERSATION_ID,
          messages: () => messages.value,
        });
        return () => (progress.value ? h(RunTaskProgressTray, { taskState: progress.value }) : null);
      },
    }));
    app.mount(host);
    return { host, messages };
  }

  it('运行中显示本轮最新一次计划：一行“阶段 · 下一步”，点开看目标、计划、下一步；运行结束收起', async () => {
    setRun('running');
    const { host, messages } = mount([
      taskWrite('old-run', taskState('plan', '上一轮的事'), 'run-old'),
      taskWrite('w1', taskState('plan', '查三家公司年报')),
      // task_read 只是读回，不代表计划变了。
      taskWrite('r1', taskState('verify', '不该显示'), RUN_ID, 'task_read'),
    ]);
    await nextTick();
    const bar = host.querySelector<HTMLButtonElement>('.task-tray__bar');
    expect(bar?.textContent?.replace(/\s+/g, '')).toBe('规划查三家公司年报');

    messages.value = [...messages.value, taskWrite('w2', taskState('execute', '查 InfoLink 排名'))];
    await nextTick();
    expect(host.querySelector('.task-tray__phase')?.textContent).toBe('执行');
    expect(host.querySelector('.task-tray__step')?.textContent).toBe('查 InfoLink 排名');

    host.querySelector<HTMLButtonElement>('.task-tray__bar')?.click();
    await nextTick();
    expect(host.querySelector('.task-tray__goal')?.textContent).toContain('储能电池出货量');
    expect([...host.querySelectorAll('.task-tray__plan li')].map(li => li.textContent)).toEqual(['查年报', '交叉核对排名', '写入文档']);
    expect([...host.querySelectorAll('.task-tray__next li')].map(li => li.textContent)).toEqual(['查 InfoLink 排名', '对照口径差异']);

    // 暂停后还会继续，计划照常显示。
    setRun('paused');
    await nextTick();
    expect(host.querySelector('[data-run-task-tray]')).not.toBeNull();

    setRun('completed');
    await nextTick();
    expect(host.querySelector('[data-run-task-tray]')).toBeNull();
  });

  it('本轮还没写过计划（或最新一次不在已加载的消息里）时不显示', async () => {
    setRun('running');
    const { host } = mount([taskWrite('old-run', taskState('plan', '上一轮的事'), 'run-old')]);
    await nextTick();
    expect(host.querySelector('[data-run-task-tray]')).toBeNull();
  });
});
