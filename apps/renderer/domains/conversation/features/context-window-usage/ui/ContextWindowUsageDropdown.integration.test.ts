// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import type { ContextWindowUsagePresentation } from '../definitions/contextWindowUsage';
import ContextWindowUsageDropdown from './ContextWindowUsageDropdown.vue';

vi.mock('../../../ui/useConversationLocalization', () => ({
  useConversationLocalization: () => ({
    currentLocale: { value: 'zh-CN' },
    conversationMessage: (key: string, params?: Record<string, string | number>) => (
      key === 'conversation.contextUsage.total'
        ? `${params?.used} / ${params?.budget} Tokens`
        : key
    ),
  }),
}));

interface MountedContextUsage {
  readonly host: HTMLElement;
  readonly unmount: () => void;
}

function mountContextUsage(
  presentation: ContextWindowUsagePresentation,
): MountedContextUsage {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({
    render: () => h(ContextWindowUsageDropdown, {
      presentation,
      conversationInformation: {
        createdAt: new Date(2026, 7, 17, 9, 30).getTime(),
        userMessageCount: 12,
      },
    }),
  });
  app.mount(host);
  return {
    host,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

const mountedViews: MountedContextUsage[] = [];

afterEach(() => {
  while (mountedViews.length > 0) mountedViews.pop()?.unmount();
});

const availablePresentation: ContextWindowUsagePresentation = {
  status: 'current',
  level: 'normal',
  ratio: 0.53,
  drawPercent: 53,
  isHistoricalModel: false,
  contextWindowTokens: 100_000,
  segments: [
    { id: 'system_prompt', tokens: 5_000, share: 0.05 },
    { id: 'tool_definitions', tokens: 5_000, share: 0.05 },
    { id: 'conversation', tokens: 43_000, share: 0.43 },
  ],
  usage: {
    budget_model_id: 'model-a',
    used_tokens: 53_000,
    components: {
      system_prompt_tokens: 5_000,
      conversation_tokens: 43_000,
      tool_definition_tokens: 5_000,
    },
    input_budget_tokens: 80_000,
    remaining_tokens: 27_000,
    output_limit_tokens: 20_000,
    source: 'local-estimate',
    confidence: 'estimate',
  },
};

describe('ContextWindowUsageDropdown integration', () => {
  it('圆环打开无关闭按钮的三分类明细，并把 Teleport 面板视为内部点击', async () => {
    const mounted = mountContextUsage(availablePresentation);
    mountedViews.push(mounted);
    const trigger = mounted.host.querySelector('.context-window-usage-trigger');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('context usage trigger not found');

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(mounted.host.querySelector('.context-window-usage-trigger__value')
      ?.getAttribute('stroke-dasharray')).toBe('53 100');

    trigger.click();
    await nextTick();
    await nextTick();

    const panel = document.body.querySelector('.usage-breakdown-panel');
    if (!(panel instanceof HTMLElement)) throw new Error('context usage panel not found');
    expect(panel.getAttribute('role')).toBe('dialog');
    const rows = [...panel.querySelectorAll('.usage-breakdown-panel__row')];
    expect(rows).toHaveLength(3);
    expect(rows.map(row => row.querySelector('.usage-breakdown-panel__row-label')?.textContent)).toEqual([
      'conversation.contextUsage.row.systemPrompt',
      'conversation.contextUsage.row.toolDefinitions',
      'conversation.contextUsage.row.conversation',
    ]);
    expect(panel.textContent).toContain('conversation.contextUsage.row.systemPrompt');
    expect(panel.textContent).toContain('conversation.contextUsage.row.conversation');
    expect(panel.textContent).toContain('conversation.contextUsage.row.toolDefinitions');
    expect(panel.textContent).toContain('~ 5K');
    expect(panel.textContent).toContain('~ 43K');
    expect(panel.textContent).toContain('~ 53K / 100K Tokens');
    expect(panel.querySelector('[role="progressbar"]')?.getAttribute('aria-valuemax')).toBe('100000');
    expect(panel.textContent).not.toContain('conversation.contextUsage.measurement');
    expect(panel.textContent).not.toContain('conversation.contextUsage.budgetModel');
    expect(panel.textContent).not.toContain('conversation.contextUsage.window');
    expect(panel.querySelector('button')).toBeNull();
    const detailRows = [...panel.querySelectorAll('.usage-breakdown-panel__detail-row')];
    expect(detailRows).toHaveLength(2);
    expect(panel.textContent).toContain('conversation.contextUsage.conversationInfo.createdAt');
    expect(panel.textContent).toContain('conversation.contextUsage.conversationInfo.userMessageCount');
    expect(detailRows[1]?.textContent).toContain('12');

    panel.click();
    await nextTick();
    expect(document.body.querySelector('.usage-breakdown-panel')).toBe(panel);
  });

  it('没有快照时不渲染圆环和面板', () => {
    const mounted = mountContextUsage({ status: 'unavailable' });
    mountedViews.push(mounted);
    expect(mounted.host.querySelector('.context-window-usage-trigger')).toBeNull();
    expect(mounted.host.querySelector('.context-window-usage-trigger__value')).toBeNull();
    expect(document.body.querySelector('.usage-breakdown-panel')).toBeNull();
  });

  it('历史窗口不含尾部时保留诊断入口', async () => {
    const mounted = mountContextUsage({ status: 'tail_unavailable' });
    mountedViews.push(mounted);
    const trigger = mounted.host.querySelector('.context-window-usage-trigger');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('context usage trigger not found');

    trigger.click();
    await nextTick();

    const panel = document.body.querySelector('.usage-breakdown-panel');
    expect(panel?.textContent).toContain('conversation.contextUsage.empty.tailUnavailable');
    expect(panel?.querySelector('[role="progressbar"]')).toBeNull();
  });
});
