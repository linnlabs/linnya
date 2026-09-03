// @vitest-environment jsdom

import { createApp, defineComponent, nextTick, reactive, ref, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestUserMessage } from '../../testing/functions/createConversationTestMessage';

const writeClipboardText = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../useConversationLocalization', () => ({
  useConversationLocalization: () => ({
    currentLocale: ref('zh-CN'),
    conversationMessage: (key: string) => key,
  }),
}));

vi.mock('../../features/image-attachments', () => ({
  ConversationImageAttachmentEditor: defineComponent({ template: '<div />' }),
  ConversationImageAttachmentGallery: defineComponent({ template: '<div />' }),
  hasConversationImageSelectionChanged: () => false,
  useConversationImageEditSession: () => ({
    store: reactive({
      messageId: null,
      isSubmitting: false,
    }),
    controller: {
      start: () => true,
      cancel: () => undefined,
      beginSubmission: () => null,
      failSubmission: () => undefined,
    },
  }),
}));

import UserMessage from './UserMessage.vue';

Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: { writeText: writeClipboardText },
});

describe('UserMessage copy feedback', () => {
  let app: App<Element> | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    writeClipboardText.mockReset();
    writeClipboardText.mockResolvedValue(undefined);
  });

  afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('复制用户消息后在稳定按钮 DOM 内显示反馈，并在两秒后恢复图标', async () => {
    const message = createTestUserMessage({ content: '需要复制的用户消息' });
    const mountPoint = document.createElement('div');
    const rendererErrors: unknown[] = [];
    document.body.appendChild(mountPoint);
    app = createApp(UserMessage, { message });
    app.config.errorHandler = error => rendererErrors.push(error);
    app.mount(mountPoint);
    await nextTick();

    const button = mountPoint.querySelector<HTMLButtonElement>('.user-message-copy-button');
    const icon = button?.querySelector<HTMLElement>('.copy-feedback-icon');
    const copiedText = button?.querySelector<HTMLElement>('.copied-text');
    const svg = icon?.querySelector('svg');
    expect(button).not.toBeNull();
    expect(icon?.hidden).toBe(false);
    expect(copiedText?.hidden).toBe(true);

    button?.click();
    await Promise.resolve();
    await nextTick();

    expect(writeClipboardText).toHaveBeenCalledWith(message.content);
    expect(icon?.hidden).toBe(true);
    expect(copiedText?.hidden).toBe(false);
    expect(icon?.querySelector('svg')).toBe(svg);
    expect(rendererErrors).toEqual([]);

    await vi.advanceTimersByTimeAsync(2_000);
    await nextTick();

    expect(icon?.hidden).toBe(false);
    expect(copiedText?.hidden).toBe(true);
    expect(icon?.querySelector('svg')).toBe(svg);
    expect(rendererErrors).toEqual([]);
  });
});
