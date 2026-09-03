// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';
import ToolErrorCard from './ToolErrorCard.vue';

vi.mock('../../useConversationLocalization', () => ({
  useConversationLocalization: () => ({
    conversationMessage: (key: string) => key,
  }),
}));

let mountedApp: ReturnType<typeof createApp> | undefined;
let mountPoint: HTMLDivElement | undefined;

afterEach(() => {
  mountedApp?.unmount();
  mountPoint?.remove();
  mountedApp = undefined;
  mountPoint = undefined;
});

describe('ToolErrorCard', () => {
  it('有正式修复动作时展示按钮并转交点击', () => {
    const onAction = vi.fn();
    mountPoint = document.createElement('div');
    document.body.appendChild(mountPoint);
    mountedApp = createApp(ToolErrorCard, {
      errorMessage: '尚未配置图片生成模型。',
      actionLabel: '去配置',
      onAction,
    });
    mountedApp.mount(mountPoint);

    expect(mountPoint.querySelector('.tool-error-card--actionable')?.textContent).toContain('尚未配置图片生成模型。');
    const button = mountPoint.querySelector<HTMLButtonElement>('.action-btn.primary');
    expect(button?.textContent?.trim()).toBe('去配置');
    button?.click();
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('普通错误直接展示真实错误，不制造第二层详细信息入口', () => {
    mountPoint = document.createElement('div');
    document.body.appendChild(mountPoint);
    mountedApp = createApp(ToolErrorCard, {
      errorMessage: 'Provider returned HTTP 429',
    });
    mountedApp.mount(mountPoint);

    expect(mountPoint.textContent?.trim()).toBe('Provider returned HTTP 429');
    expect(mountPoint.querySelector('.tool-error-card__raw-toggle')).toBeNull();
  });
});
