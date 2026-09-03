import { describe, expect, it } from 'vitest';
import {
  arePptPlansEqual,
  buildApproveSubmission,
  buildModifySubmission,
  createBlankEditablePptPlanPage,
  createEditablePptPlanData,
  deleteEditablePptPlanPage,
  insertEditablePptPlanPage,
  moveEditablePptPlanPage,
  readModifiedPptPlanFromInteraction,
  restoreDeletedEditablePptPlanPage,
  readPptPlanData,
  readPptPlanInteractionStatus,
  toPptPlanData,
} from './pptPlanInteraction';

function createVisualDirection() {
  return {
    concept: '克制可信的经营分析风。',
    composition: '高密度证据页与留白结论页交替。',
    signature: '每章使用一次超大结论数字。',
  };
}

describe('pptPlanInteraction helpers', () => {
  it('计划字段插入顺序不同时不应误判为用户修改', () => {
    const sourcePlan = readPptPlanData({
      data: {
        title: '季度复盘',
        pageCount: 1,
        visualDirection: createVisualDirection(),
        pages: [{ title: '结论', content: '先说明核心判断。', slideNumber: 1 }],
      },
    });
    const editablePlan = sourcePlan ? createEditablePptPlanData(sourcePlan) : null;
    const normalizedPlan = editablePlan ? toPptPlanData(editablePlan) : null;

    expect(JSON.stringify(sourcePlan)).not.toBe(JSON.stringify(normalizedPlan));
    expect(arePptPlansEqual(sourcePlan, normalizedPlan)).toBe(true);
  });

  it('批准提交应生成 approve payload', () => {
    expect(buildApproveSubmission()).toEqual({
      observation: '{"action":"approve"}',
      data: { action: 'approve' },
      interactionResponse: {
        status: 'approved',
        response: { action: 'approve' },
      },
    });
  });

  it('修改提交应生成 modify payload', () => {
    const plan = {
      title: 'Growth Review',
      audience: 'Management',
      pageCount: 1,
      visualDirection: createVisualDirection(),
      pages: [{ slideNumber: 1, title: 'Overview', content: '这一页讲清业务回顾的结论和关键数据。' }],
    };

    const submission = buildModifySubmission(plan, '把结论页拆成两页');
    expect(JSON.parse(submission.observation)).toEqual({
      action: 'modify',
      plan,
      notes: '把结论页拆成两页',
    });
    expect(submission).toMatchObject({
      data: {
        action: 'modify',
        plan,
        notes: '把结论页拆成两页',
      },
      interactionResponse: {
        status: 'modified',
        response: {
          action: 'modify',
          plan,
          notes: '把结论页拆成两页',
        },
      },
    });
  });

  it('应从统一 interaction metadata 读取 ppt_plan 交互状态', () => {
    expect(
      readPptPlanInteractionStatus({
        interaction: {
          status: 'approved',
          submittedAt: 123,
          response: {
            action: 'modify',
            notes: '保留现有结构，只补充讲稿备注',
          },
        },
      }),
    ).toEqual({
      status: 'approved',
      submittedAt: 123,
      notes: '保留现有结构，只补充讲稿备注',
    });
  });

  it('应从 StructuredToolResult 读取 plan data', () => {
    expect(
      readPptPlanData({
        data: {
          title: 'Growth Review',
          pageCount: 1,
          audience: 'Management',
          visualDirection: createVisualDirection(),
          pages: [{ slideNumber: 1, title: 'Overview', content: '讲清整体业务进展与结论。' }],
        },
      }),
    ).toEqual({
      title: 'Growth Review',
      pageCount: 1,
      audience: 'Management',
      visualDirection: createVisualDirection(),
      pages: [{ slideNumber: 1, title: 'Overview', content: '讲清整体业务进展与结论。' }],
    });
  });

  it('应直接从 tool_call arguments 读取 plan data', () => {
    expect(
      readPptPlanData({
        title: 'Growth Review',
        audience: 'Management',
        visualDirection: createVisualDirection(),
        pages: [{ title: 'Overview', content: '讲清整体业务进展与结论。' }],
      }),
    ).toEqual({
      title: 'Growth Review',
      pageCount: 1,
      audience: 'Management',
      visualDirection: createVisualDirection(),
      pages: [{ slideNumber: 1, title: 'Overview', content: '讲清整体业务进展与结论。' }],
    });
  });

  it('修改后的交互回复应优先恢复用户提交过的 plan', () => {
    expect(
      readModifiedPptPlanFromInteraction({
        interaction: {
          status: 'modified',
          response: {
            action: 'modify',
            notes: '把结论拆成两页',
            plan: {
              title: 'Growth Review',
              pageCount: 2,
              visualDirection: createVisualDirection(),
              pages: [
                { slideNumber: 1, title: 'Overview', content: '先交代背景。' },
                { slideNumber: 2, title: 'Conclusion', content: '单独讲结论。' },
              ],
            },
          },
        },
      }),
    ).toEqual({
      title: 'Growth Review',
      pageCount: 2,
      visualDirection: createVisualDirection(),
      pages: [
        { slideNumber: 1, title: 'Overview', content: '先交代背景。' },
        { slideNumber: 2, title: 'Conclusion', content: '单独讲结论。' },
      ],
    });
  });

  it('插入空白页后应重排页码和 pageCount', () => {
    const plan = createEditablePptPlanData(
      {
        title: '季度复盘',
        pageCount: 2,
        visualDirection: createVisualDirection(),
        pages: [
          { slideNumber: 1, title: '背景', content: '介绍项目背景。' },
          { slideNumber: 2, title: '进展', content: '总结关键进展。' },
        ],
      },
      (page, index) => `source-${page.slideNumber}-${index}`,
    );

    const inserted = insertEditablePptPlanPage(plan, 1, createBlankEditablePptPlanPage('new-page'));

    expect(inserted.pageCount).toBe(3);
    expect(inserted.pages.map((page) => page.slideNumber)).toEqual([1, 2, 3]);
    expect(inserted.pages.map((page) => page.localId)).toEqual(['source-1-0', 'new-page', 'source-2-1']);
    expect(inserted.pages[1]).toMatchObject({ title: '', content: '' });
  });

  it('删除后应支持最近一次撤销并重排页码', () => {
    const plan = createEditablePptPlanData(
      {
        title: '季度复盘',
        pageCount: 3,
        visualDirection: createVisualDirection(),
        pages: [
          { slideNumber: 1, title: '背景', content: '介绍项目背景。' },
          { slideNumber: 2, title: '进展', content: '总结关键进展。' },
          { slideNumber: 3, title: '下一步', content: '说明后续计划。' },
        ],
      },
      (page, index) => `source-${page.slideNumber}-${index}`,
    );

    const deletion = deleteEditablePptPlanPage(plan, 'source-2-1');
    expect(deletion.deleted?.page.title).toBe('进展');
    expect(deletion.plan.pages.map((page) => `${page.slideNumber}:${page.title}`)).toEqual(['1:背景', '2:下一步']);

    const restored = restoreDeletedEditablePptPlanPage(deletion.plan, deletion.deleted);
    expect(restored.pages.map((page) => `${page.slideNumber}:${page.title}`)).toEqual(['1:背景', '2:进展', '3:下一步']);
  });

  it('移动页面到插入点后应保持 localId 并重排页码', () => {
    const plan = createEditablePptPlanData(
      {
        title: '季度复盘',
        pageCount: 3,
        visualDirection: createVisualDirection(),
        pages: [
          { slideNumber: 1, title: '背景', content: '介绍项目背景。' },
          { slideNumber: 2, title: '进展', content: '总结关键进展。' },
          { slideNumber: 3, title: '下一步', content: '说明后续计划。' },
        ],
      },
      (page, index) => `source-${page.slideNumber}-${index}`,
    );

    const moved = moveEditablePptPlanPage(plan, 'source-3-2', 1);

    expect(moved.pages.map((page) => `${page.slideNumber}:${page.localId}:${page.title}`)).toEqual([
      '1:source-1-0:背景',
      '2:source-3-2:下一步',
      '3:source-2-1:进展',
    ]);
  });

  it('提交前应剥离本地 localId 并输出干净 PptPlanData', () => {
    const editablePlan = createEditablePptPlanData(
      {
        title: '季度复盘',
        pageCount: 2,
        visualDirection: createVisualDirection(),
        pages: [
          { slideNumber: 1, title: '背景', content: '介绍项目背景。' },
          { slideNumber: 2, title: '进展', content: '总结关键进展。' },
        ],
      },
      (page, index) => `source-${page.slideNumber}-${index}`,
    );

    const normalized = toPptPlanData(moveEditablePptPlanPage(editablePlan, 'source-2-1', 0));

    expect(normalized).toEqual({
      title: '季度复盘',
      pageCount: 2,
      visualDirection: createVisualDirection(),
      pages: [
        { slideNumber: 1, title: '进展', content: '总结关键进展。' },
        { slideNumber: 2, title: '背景', content: '介绍项目背景。' },
      ],
    });
    expect(JSON.stringify(normalized)).not.toContain('localId');
  });
});
