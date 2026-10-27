// @vitest-environment jsdom
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 进度指示器依赖消息宿主提供的执行上下文；这里只关心它收到的文案。
vi.mock('../../../shared/execution-presentation', async () => {
  const { defineComponent, h: createElement } = await import('vue');
  return {
    ToolActivityIndicator: defineComponent({
      props: { runningLabel: { type: String, default: '' } },
      setup: props => () => createElement('span', props.runningLabel),
    }),
  };
});
import { ensureConversationLocalizationRegistered } from '../../../registrations/ensureConversationLocalizationRegistered';
import SkillLearnedCard from './SkillLearnedCard.vue';
import type { SkillPresentationData } from './definitions/skillPresentation';
import type { ToolCardPresentation } from '../types';

let app: App | undefined;
afterEach(() => { app?.unmount(); app = undefined; document.body.innerHTML = ''; });

async function render(data: SkillPresentationData, status: 'loading' | 'success'): Promise<string> {
  ensureConversationLocalizationRegistered();
  const container = document.createElement('div'); document.body.append(container);
  const presentation = { uiKey: 'skill_manage', status, data } as unknown as ToolCardPresentation<SkillPresentationData>;
  app = createApp({ render: () => h(SkillLearnedCard, { presentation }) });
  app.use(createPinia()); app.mount(container); await nextTick();
  return container.textContent?.trim() ?? '';
}

describe('skill_manage 工具卡文案', () => {
  const manage = (action: Extract<SkillPresentationData, { kind: 'manage' }>['action'], path?: string): SkillPresentationData =>
    ({ kind: 'manage', action, skillName: action === 'list' ? undefined : 'weekly-report', path });

  it('每个动作完成后用一句话说明结果，不暴露参数', async () => {
    expect(await render(manage('install'), 'success')).toBe('已安装技能「weekly-report」');
    expect(await render(manage('update'), 'success')).toBe('已升级技能「weekly-report」');
    expect(await render(manage('remove'), 'success')).toBe('已卸载技能「weekly-report」');
    expect(await render(manage('validate'), 'success')).toBe('已校验技能「weekly-report」');
    expect(await render(manage('list'), 'success')).toBe('已查看已安装的技能');
  });

  it('文件类动作带上文件路径', async () => {
    expect(await render(manage('edit', 'SKILL.md'), 'success')).toBe('已编辑技能「weekly-report」/ SKILL.md');
    expect(await render(manage('write', 'references/a.md'), 'success')).toBe('已编辑技能「weekly-report」/ references/a.md');
    expect(await render(manage('delete_file', 'old.txt'), 'success')).toBe('已删除技能「weekly-report」中的 old.txt');
    expect(await render(manage('read', 'SKILL.md'), 'success')).toBe('已读取weekly-report / SKILL.md');
  });

  it('执行中使用进行时文案', async () => {
    expect(await render(manage('install'), 'loading')).toContain('正在安装技能「weekly-report」');
  });
});
