// @vitest-environment jsdom

import { computed, createApp, defineComponent, h, nextTick, ref, type App } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationToolMessageStatus } from '@app/schemas';
import type { ToolActivityTextEffect } from '@linnya/plugin-host-contract/renderer/executionPresentation';
import type { ExecutionActivityState } from '../definitions/executionActivity';
import {
  ExecutionProgressText,
  ToolActivityIndicator,
  executionActivity,
  provideToolExecutionActivity,
} from '..';

vi.mock('@app/localization', () => ({
  useLocalization: () => ({
    message: (key: string) => key,
  }),
}));

describe('工具执行展示的动画归属', () => {
  let app: App<Element> | undefined;

  afterEach(() => {
    app?.unmount();
    document.body.innerHTML = '';
  });

  it('普通工具只在标题扫光，暂停停止、恢复重启，已结算工具不因 run 继续而复活', async () => {
    const state = ref<ExecutionActivityState>('running');
    const status = ref<ConversationToolMessageStatus>('loading');
    const mountPoint = document.createElement('div');
    document.body.appendChild(mountPoint);
    app = createApp(
      defineComponent({
        setup() {
          const activity = provideToolExecutionActivity(
            () => status.value,
            computed(() => executionActivity(state.value)),
            () => true
          );
          return () =>
            h('article', [
              h(
                'header',
                h(ExecutionProgressText, { active: activity.value.isExecuting }, () => '读取文档')
              ),
              h(ToolActivityIndicator, { runningLabel: '读取文档中' }),
            ]);
        },
      })
    );
    app.mount(mountPoint);

    expect(mountPoint.querySelectorAll('.execution-progress-text--shimmer')).toHaveLength(1);
    expect(mountPoint.querySelector('header .execution-progress-text--shimmer')).not.toBeNull();
    expect(mountPoint.querySelector('.tool-activity')?.textContent).toContain('读取文档中');

    for (const stopped of ['pausing', 'paused', 'awaiting_user', 'reconnecting'] as const) {
      state.value = stopped;
      await nextTick();
      expect(mountPoint.querySelector('.execution-progress-text--shimmer')).toBeNull();
      expect(mountPoint.querySelector('header')?.textContent).toBe('读取文档');
      expect(mountPoint.querySelector('.tool-activity')?.textContent).toContain(
        stopped === 'reconnecting'
          ? 'conversation.execution.running'
          : 'conversation.execution.paused'
      );
      expect(status.value).toBe('loading');
    }

    state.value = 'running';
    await nextTick();
    expect(mountPoint.querySelectorAll('.execution-progress-text--shimmer')).toHaveLength(1);
    status.value = 'success';
    await nextTick();
    expect(mountPoint.querySelector('.execution-progress-text--shimmer')).toBeNull();
    expect(mountPoint.querySelector('.tool-activity')?.textContent).toContain(
      'conversation.execution.finished'
    );
  });

  it('无外层标题的卡片在原占位区域展示进度，扫光、呼吸和静态文字遵守同一执行态', async () => {
    const state = ref<ExecutionActivityState>('running');
    const effect = ref<ToolActivityTextEffect>('shimmer');
    const mountPoint = document.createElement('div');
    document.body.appendChild(mountPoint);
    app = createApp(
      defineComponent({
        setup() {
          provideToolExecutionActivity(
            () => 'loading',
            computed(() => executionActivity(state.value)),
            () => false
          );
          return () =>
            h(ToolActivityIndicator, { runningLabel: '生成内容中', effect: effect.value });
        },
      })
    );
    app.mount(mountPoint);

    for (const variant of ['shimmer', 'pulse', 'none'] as const) {
      effect.value = variant;
      state.value = 'running';
      await nextTick();
      expect(mountPoint.textContent).toContain('生成内容中');
      expect(mountPoint.querySelectorAll('[class*="execution-progress-text--"]')).toHaveLength(
        variant === 'none' ? 0 : 1
      );
      state.value = 'paused';
      await nextTick();
      expect(mountPoint.querySelector('[class*="execution-progress-text--"]')).toBeNull();
      expect(mountPoint.textContent).toContain('conversation.execution.paused');
    }
  });
});
