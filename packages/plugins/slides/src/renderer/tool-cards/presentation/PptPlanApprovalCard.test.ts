// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, type Pinia } from 'pinia';
import { createApp, nextTick, type App } from 'vue';
import {
  clearLocalizationRegistryForTest,
  registerMessageCatalogs,
  useLocalizationStore,
} from '@app/localization';
import type { ToolPresentationProjectorInput } from '@linnya/plugin-host-contract/renderer/toolUi';
import PptPlanApprovalCard from './PptPlanApprovalCard.vue';
import { SLIDES_TOOL_CARD_MESSAGE_CATALOG } from '../definitions/slidesToolCardMessageCatalog';
import { projectSlidesPlanPresentation } from '../functions/projectSlidesToolPresentation';

vi.mock('@plugin/renderer/interactiveTool', () => ({
  concludeInteractiveToolInteraction: vi.fn(),
}));

function mountPptPlanApprovalCard(props: InstanceType<typeof PptPlanApprovalCard>['$props']) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const pinia = createPinia();
  const app = createApp(PptPlanApprovalCard, props);
  app.use(pinia);
  app.mount(host);
  return { app, host, pinia };
}

function setLocale(pinia: Pinia, locale: 'zh-CN' | 'en-US'): void {
  useLocalizationStore(pinia).setCurrentLocale(locale);
}

function createPlan(pages: Array<{ slideNumber: number; title: string; content: string }>) {
  return {
    data: {
      title: '季度复盘',
      pageCount: pages.length,
      visualDirection: {
        concept: '克制可信的经营分析风。',
        composition: '高密度证据页与留白结论页交替。',
        signature: '每章使用一次超大结论数字。',
      },
      pages,
    },
  };
}

function toPlanArgs(plan: ReturnType<typeof createPlan>['data']) {
  return {
    title: plan.title,
    visualDirection: plan.visualDirection,
    pages: plan.pages.map(({ title, content }) => ({ title, content })),
  };
}

function createCardProps(input: {
  readonly args?: unknown;
  readonly result?: unknown;
  readonly status: 'loading' | 'success';
  readonly messageId: string;
  readonly toolCallId: string;
  readonly interaction?: ToolPresentationProjectorInput['interaction'];
}) {
  const phase = input.status === 'loading' ? 'start' : 'complete';
  return {
    messageId: input.messageId,
    presentation: {
      uiKey: 'ppt_plan',
      status: input.status,
      phase,
      ...projectSlidesPlanPresentation({
        sourceToolName: 'ppt_plan',
        uiKey: 'ppt_plan',
        toolCallId: input.toolCallId,
        args: input.args ?? {},
        result: input.result,
        status: input.status,
        phase,
        interaction: input.interaction,
      }),
    },
  };
}

function clickDragHandle(handle: HTMLElement) {
  handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
  handle.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
}

describe('PptPlanApprovalCard', () => {
  const mountedApps: App[] = [];

  beforeEach(() => {
    clearLocalizationRegistryForTest();
    registerMessageCatalogs(SLIDES_TOOL_CARD_MESSAGE_CATALOG);
  });

  afterEach(() => {
    for (const app of mountedApps) {
      app.unmount();
    }
    mountedApps.length = 0;
    document.body.innerHTML = '';
    clearLocalizationRegistryForTest();
  });

  it('创建计划且暂无内容时不应提前展示大纲标题', () => {
    const { app, host } = mountPptPlanApprovalCard(createCardProps({
      args: {},
      result: {},
      status: 'loading',
      messageId: 'msg_1',
      toolCallId: 'call_1',
    }));
    mountedApps.push(app);

    expect(host.textContent).toContain('正在创建大纲...');
    expect(host.textContent).not.toContain('演示文稿大纲');
  });

  it('应像 ask 一样从 arguments 恢复等待中的计划卡片', () => {
    const { app, host } = mountPptPlanApprovalCard(createCardProps({
      args: {
        title: '季度复盘',
        audience: '管理层',
        visualDirection: {
          concept: '克制可信的经营分析风。',
          composition: '高密度证据页与留白结论页交替。',
          signature: '每章使用一次超大结论数字。',
        },
        pages: [
          { title: '背景', content: '介绍项目背景。' },
          { title: '进展', content: '总结关键进展。' },
        ],
      },
      result: {},
      status: 'loading',
      messageId: 'msg_args_only',
      toolCallId: 'call_args_only',
    }));
    mountedApps.push(app);

    expect(host.textContent).toContain('演示文稿大纲');
    expect(host.textContent).toContain('季度复盘');
    expect(host.textContent).toContain('管理层');
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="设计理念"]')?.value).toBe('克制可信的经营分析风。');
    expect(host.textContent).not.toContain('正在创建大纲...');
  });

  it('应直接展示并允许修改三项视觉设计信息', async () => {
    const { app, host } = mountPptPlanApprovalCard(createCardProps({
      args: {},
      result: createPlan([{ slideNumber: 1, title: '结论', content: '先说明核心判断。' }]),
      status: 'success',
      messageId: 'msg_visual_direction',
      toolCallId: 'call_visual_direction',
    }));
    mountedApps.push(app);

    expect(host.textContent).not.toContain('视觉方向');
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="构图与节奏"]')?.value)
      .toBe('高密度证据页与留白结论页交替。');
    const approveButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === '批准并继续',
    );
    expect(approveButton?.classList.contains('primary')).toBe(true);
    expect(approveButton?.disabled).toBe(false);

    const signature = host.querySelector<HTMLTextAreaElement>('[aria-label="视觉记忆点"]');
    if (!signature) throw new Error('Expected visual signature editor');
    signature.value = '使用一条贯穿章节的细规则线。';
    signature.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();

    const submitButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === '提交修改',
    );
    expect(submitButton?.disabled).toBe(false);

    expect(submitButton?.classList.contains('secondary')).toBe(true);
    expect(approveButton?.disabled).toBe(true);
  });

  it('最后一页不应渲染继续向下的时间线连接线', () => {
    const { app, host } = mountPptPlanApprovalCard(createCardProps({
      args: {},
      result: createPlan([
        { slideNumber: 1, title: '背景', content: '介绍项目背景。' },
        { slideNumber: 2, title: '进展', content: '总结关键进展。' },
        { slideNumber: 3, title: '下一步', content: '说明后续计划。' },
      ]),
      status: 'success',
      messageId: 'msg_2',
      toolCallId: 'call_2',
    }));
    mountedApps.push(app);

    const pageSections = Array.from(host.querySelectorAll('.page-section'));
    expect(pageSections).toHaveLength(3);
    expect(pageSections[0]?.classList.contains('page-section--with-connector')).toBe(true);
    expect(pageSections[1]?.classList.contains('page-section--with-connector')).toBe(true);
    expect(pageSections[2]?.classList.contains('page-section--with-connector')).toBe(false);
  });

  it('应在每个插入点新增空白页并阻止提交未填完整的计划', async () => {
    const { app, host } = mountPptPlanApprovalCard(createCardProps({
      args: {},
      result: createPlan([
        { slideNumber: 1, title: '背景', content: '介绍项目背景。' },
        { slideNumber: 2, title: '进展', content: '总结关键进展。' },
        { slideNumber: 3, title: '下一步', content: '说明后续计划。' },
      ]),
      status: 'success',
      messageId: 'msg_3',
      toolCallId: 'call_3',
    }));
    mountedApps.push(app);

    const insertButtons = host.querySelectorAll<HTMLButtonElement>('.page-insert-button');
    expect(insertButtons).toHaveLength(4);
    insertButtons[1]?.click();
    await nextTick();

    expect(Array.from(host.querySelectorAll('.page-section__marker')).map((node) => node.textContent?.trim())).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
    expect(host.textContent).toContain('共 4 页');
    expect(host.textContent).toContain('请补全所有页面的标题和主要内容。');
    expect(Array.from(host.querySelectorAll('.page-section__title')).map((node) => node.textContent?.trim())).toEqual([
      '背景',
      '',
      '进展',
      '下一步',
    ]);

    const submitButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === '提交修改',
    );
    expect(submitButton?.disabled).toBe(true);
  });

  it('单页计划的删除菜单项应禁用', async () => {
    const { app, host } = mountPptPlanApprovalCard(createCardProps({
      args: {},
      result: createPlan([{ slideNumber: 1, title: '背景', content: '介绍项目背景。' }]),
      status: 'success',
      messageId: 'msg_4',
      toolCallId: 'call_4',
    }));
    mountedApps.push(app);

    const dragHandle = host.querySelector<HTMLElement>('[aria-label="拖动或打开第 1 页操作菜单"]');
    expect(dragHandle?.getAttribute('data-drag-handle')).toBe('true');
    if (!dragHandle) throw new Error('Expected drag handle');
    clickDragHandle(dragHandle);
    await nextTick();

    const disabledMenuItems = Array.from(document.body.querySelectorAll('.select-option.is-disabled'));
    expect(disabledMenuItems.some((item) => item.textContent?.includes('删除'))).toBe(true);
  });

  it('删除菜单项上方应显示分割线', async () => {
    const { app, host } = mountPptPlanApprovalCard(createCardProps({
      args: {},
      result: createPlan([
        { slideNumber: 1, title: '背景', content: '介绍项目背景。' },
        { slideNumber: 2, title: '进展', content: '总结关键进展。' },
      ]),
      status: 'success',
      messageId: 'msg_4_1',
      toolCallId: 'call_4_1',
    }));
    mountedApps.push(app);

    const dragHandle = host.querySelector<HTMLElement>('[aria-label="拖动或打开第 1 页操作菜单"]');
    if (!dragHandle) throw new Error('Expected drag handle');
    clickDragHandle(dragHandle);
    await nextTick();

    const menu = document.body.querySelector<HTMLElement>('.select-options');
    const options = Array.from(menu?.children ?? []);
    const deleteIndex = options.findIndex((node) => node.textContent?.includes('删除'));
    expect(deleteIndex).toBeGreaterThan(0);
    expect(options[deleteIndex - 1]?.classList.contains('select-separator')).toBe(true);
  });

  it('菜单中仅删除项应显示图标', async () => {
    const { app, host } = mountPptPlanApprovalCard(createCardProps({
      args: {},
      result: createPlan([
        { slideNumber: 1, title: '背景', content: '介绍项目背景。' },
        { slideNumber: 2, title: '进展', content: '总结关键进展。' },
      ]),
      status: 'success',
      messageId: 'msg_4_2',
      toolCallId: 'call_4_2',
    }));
    mountedApps.push(app);

    const dragHandle = host.querySelector<HTMLElement>('[aria-label="拖动或打开第 1 页操作菜单"]');
    if (!dragHandle) throw new Error('Expected drag handle');
    clickDragHandle(dragHandle);
    await nextTick();

    const menu = document.body.querySelector<HTMLElement>('.select-options');
    const optionRows = Array.from(menu?.querySelectorAll<HTMLElement>('.select-option') ?? []);
    const rowsWithIcons = optionRows.filter((row) => row.querySelector('.option-icon'));

    expect(rowsWithIcons).toHaveLength(1);
    expect(rowsWithIcons[0]?.textContent).toContain('删除');
  });

  it('应通过拖拽柄菜单删除页面并支持最近一次撤销', async () => {
    const { app, host } = mountPptPlanApprovalCard(createCardProps({
      args: {},
      result: createPlan([
        { slideNumber: 1, title: '背景', content: '介绍项目背景。' },
        { slideNumber: 2, title: '进展', content: '总结关键进展。' },
        { slideNumber: 3, title: '下一步', content: '说明后续计划。' },
      ]),
      status: 'success',
      messageId: 'msg_5',
      toolCallId: 'call_5',
    }));
    mountedApps.push(app);

    const dragHandle = host.querySelector<HTMLElement>('[aria-label="拖动或打开第 2 页操作菜单"]');
    if (!dragHandle) throw new Error('Expected drag handle');
    clickDragHandle(dragHandle);
    await nextTick();
    const deleteItem = Array.from(document.body.querySelectorAll<HTMLElement>('.select-option')).find(
      (item) => item.textContent?.includes('删除') && !item.classList.contains('is-disabled'),
    );
    deleteItem?.click();
    await nextTick();

    expect(Array.from(host.querySelectorAll('.page-section__title')).map((node) => node.textContent?.trim())).toEqual([
      '背景',
      '下一步',
    ]);
    expect(host.textContent).toContain('已删除第 2 页');

    Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === '撤销')?.click();
    await nextTick();

    expect(Array.from(host.querySelectorAll('.page-section__title')).map((node) => node.textContent?.trim())).toEqual([
      '背景',
      '进展',
      '下一步',
    ]);
  });

  it('应通过拖拽插入点调整页面顺序', async () => {
    const { app, host } = mountPptPlanApprovalCard(createCardProps({
      args: {},
      result: createPlan([
        { slideNumber: 1, title: '背景', content: '介绍项目背景。' },
        { slideNumber: 2, title: '进展', content: '总结关键进展。' },
        { slideNumber: 3, title: '下一步', content: '说明后续计划。' },
      ]),
      status: 'success',
      messageId: 'msg_6',
      toolCallId: 'call_6',
    }));
    mountedApps.push(app);

    host.querySelectorAll<HTMLButtonElement>('.page-drag-handle')[2]?.dispatchEvent(new Event('dragstart', { bubbles: true }));
    await nextTick();

    expect(host.querySelector('.page-timeline')?.classList.contains('page-timeline--dragging')).toBe(true);
    expect(Array.from(host.querySelectorAll<HTMLButtonElement>('.page-insert-button')).every((button) => button.disabled)).toBe(true);

    host.querySelectorAll<HTMLElement>('.page-insert-slot')[1]?.dispatchEvent(new Event('dragover', { bubbles: true }));
    await nextTick();
    expect(host.querySelectorAll('.page-drop-indicator--active')).toHaveLength(1);

    host.querySelectorAll<HTMLElement>('.page-insert-slot')[1]?.dispatchEvent(new Event('drop', { bubbles: true }));
    await nextTick();

    expect(Array.from(host.querySelectorAll('.page-section__title')).map((node) => node.textContent?.trim())).toEqual([
      '背景',
      '下一步',
      '进展',
    ]);
  });

  it('已批准且无其他意见时也应保留灰态计划', () => {
    const approvedPlan = createPlan([
      { slideNumber: 1, title: '背景', content: '介绍项目背景。' },
      { slideNumber: 2, title: '进展', content: '总结关键进展。' },
    ]);
    const { app, host } = mountPptPlanApprovalCard(createCardProps({
      args: toPlanArgs(approvedPlan.data),
      result: { data: { action: 'approve' } },
      status: 'success',
      messageId: 'msg_7',
      toolCallId: 'call_7',
      interaction: {
        status: 'approved',
      },
    }));
    mountedApps.push(app);

    expect(host.textContent).toContain('已批准，Agent 继续执行。');
    expect(host.textContent).toContain('演示文稿大纲');
    expect(host.textContent).toContain('背景');
    expect(host.querySelector('.ppt-plan-card__content--disabled')).not.toBeNull();
    expect(Array.from(host.querySelectorAll('button')).some((button) => button.textContent?.includes('批准并继续'))).toBe(false);
  });

  it('已完成且填写了其他意见时应展示灰态计划', () => {
    const modifiedPlan = createPlan([
      { slideNumber: 1, title: '背景', content: '介绍项目背景。' },
      { slideNumber: 2, title: '进展', content: '总结关键进展。' },
    ]);
    const { app, host } = mountPptPlanApprovalCard(createCardProps({
      args: toPlanArgs(modifiedPlan.data),
      result: { data: { action: 'modify', plan: modifiedPlan.data, notes: '把结尾页语气收敛一点' } },
      status: 'success',
      messageId: 'msg_8',
      toolCallId: 'call_8',
      interaction: {
        status: 'modified',
        response: {
          notes: '把结尾页语气收敛一点',
          plan: modifiedPlan.data,
        },
      },
    }));
    mountedApps.push(app);

    expect(host.textContent).toContain('演示文稿大纲');
    expect(host.textContent).toContain('已提交修改，Linnya 将重新生成大纲。');
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="整体修改备注"]')?.value)
      .toBe('把结尾页语气收敛一点');
    expect(host.querySelector('.ppt-plan-card__content')?.classList.contains('ppt-plan-card__content--disabled')).toBe(true);
    expect(host.querySelectorAll('.page-insert-button')).toHaveLength(0);
    expect(host.querySelectorAll('.page-drag-handle')).toHaveLength(0);
    expect(host.querySelectorAll('[aria-label^="拖动或打开第"]')).toHaveLength(0);
    expect(host.querySelector<HTMLElement>('.page-section__title')?.getAttribute('contenteditable')).toBe('false');
  });

  it('切换语言后应立即更新整张大纲卡的用户界面文案', async () => {
    const { app, host, pinia } = mountPptPlanApprovalCard(createCardProps({
      args: {},
      result: createPlan([{ slideNumber: 1, title: 'Overview', content: 'Summarize the key finding.' }]),
      status: 'success',
      messageId: 'msg_locale',
      toolCallId: 'call_locale',
    }));
    mountedApps.push(app);

    setLocale(pinia, 'en-US');
    await nextTick();

    expect(host.textContent).toContain('Presentation Outline');
    expect(host.textContent).toContain('Concept');
    expect(host.textContent).toContain('Slides: 1');
    expect(host.textContent).toContain('Approve and continue');
    expect(host.querySelector('[aria-label="Target audience"]')).not.toBeNull();

    setLocale(pinia, 'zh-CN');
    await nextTick();

    expect(host.textContent).toContain('演示文稿大纲');
    expect(host.textContent).toContain('设计理念');
    expect(host.textContent).toContain('共 1 页');
    expect(host.textContent).toContain('批准并继续');
  });
});
