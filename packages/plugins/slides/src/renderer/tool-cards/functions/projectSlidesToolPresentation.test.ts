import { describe, expect, it } from 'vitest';
import type { ToolPresentationProjectorInput } from '@linnya/plugin-host-contract/renderer/toolUi';
import {
  projectSlidesInspectPresentation,
  projectSlidesPlanPresentation,
} from './projectSlidesToolPresentation';

const planArgs = {
  title: '经营复盘',
  audience: '管理层',
  visualDirection: {
    concept: '克制可信的经营分析风。',
    composition: '高密度证据页与留白结论页交替。',
    signature: '每章使用一次超大结论数字。',
  },
  pages: [
    { title: '核心结论', content: '先说明经营判断，再列出关键证据。' },
  ],
};

describe('projectSlidesPlanPresentation', () => {
  it('批准回复应从原始参数恢复计划，而不是把 action 结果当作计划', () => {
    expect(projectSlidesPlanPresentation({
      sourceToolName: 'ppt_plan',
      uiKey: 'ppt_plan',
      toolCallId: 'call-plan-approved',
      args: planArgs,
      result: {
        data: { action: 'approve' },
        observation: '用户已批准本次 ppt_plan 交互',
      },
      interaction: {
        status: 'approved',
        submittedAt: 123,
        response: { action: 'approve' },
      },
      status: 'success',
      phase: 'complete',
    })).toMatchObject({
      data: {
        plan: {
          title: '经营复盘',
          pageCount: 1,
          pages: [{ slideNumber: 1, title: '核心结论' }],
        },
        interaction: { status: 'approved', submittedAt: 123 },
      },
    });
  });

  it('修改回复应保留原始计划，并从交互响应读取用户修改后的计划', () => {
    const modifiedPlan = {
      title: '经营复盘（修订）',
      pageCount: 1,
      audience: '管理层',
      visualDirection: planArgs.visualDirection,
      pages: [
        { slideNumber: 1, title: '修订后的结论', content: '强化核心判断和证据。' },
      ],
    };

    expect(projectSlidesPlanPresentation({
      sourceToolName: 'ppt_plan',
      uiKey: 'ppt_plan',
      toolCallId: 'call-plan-modified',
      args: planArgs,
      result: {
        data: { action: 'modify', plan: modifiedPlan, notes: '强化结论' },
        observation: '用户已修改本次 ppt_plan 交互',
      },
      interaction: {
        status: 'modified',
        submittedAt: 456,
        response: { action: 'modify', plan: modifiedPlan, notes: '强化结论' },
      },
      status: 'success',
      phase: 'complete',
    })).toMatchObject({
      data: {
        plan: { title: '经营复盘' },
        interaction: {
          status: 'modified',
          submittedAt: 456,
          notes: '强化结论',
          modifiedPlan: { title: '经营复盘（修订）' },
        },
      },
    });
  });
});

describe('projectSlidesInspectPresentation', () => {
  it('从持久化消息合同恢复 inspect presentation，不要求执行期 preview meta', () => {
    const input: ToolPresentationProjectorInput = {
      sourceToolName: 'ppt_inspect',
      uiKey: 'ppt_inspect',
      toolCallId: 'call-inspect',
      args: { locator: 'workspace:/经营复盘.slides' },
      result: {
        data: {
          artifact: {
            presentationId: 'ppt-current',
            versionId: 'version-current',
            slideCount: 1,
          },
          document: { title: '经营复盘', locator: 'workspace:/经营复盘.slides' },
          selection: {
            requestedSlideNumbers: [1],
            shownSlideNumbers: [1],
            truncated: false,
          },
          pages: [
            { slideNumber: 1, layoutKey: 'content', elementCount: 8, editableTargetCount: 6 },
          ],
          buildStatus: { state: 'ready' },
          findingSummary: {
            rawFindingCount: 1,
            uniqueFindingCount: 1,
            rootGroupCount: 1,
            p0Count: 1,
            p1Count: 0,
            p2Count: 0,
          },
        },
        observation: 'Slides inspection\n1 个问题',
      },
      status: 'success',
      phase: 'complete',
    };

    expect(projectSlidesInspectPresentation(input)).toMatchObject({
      data: {
        kind: 'inspect',
        presentationId: 'ppt-current',
        title: '经营复盘',
        slideCount: 1,
      },
    });
  });
});
