import { describe, expect, it } from 'vitest';
import type { ToolPresentationProjectorInput } from '../../../ui/tools/types';

import { projectSingleSubrunPresentation } from '../functions/projectSingleSubrunPresentation';

function input(overrides: Partial<ToolPresentationProjectorInput> = {}): ToolPresentationProjectorInput {
  return {
    sourceToolName: 'subagent',
    uiKey: 'subagent',
    args: { description: '整理材料', prompt: '读取并整理材料' },
    result: undefined,
    status: 'loading',
    phase: 'start',
    ...overrides,
  };
}

describe('projectSingleSubrunPresentation', () => {
  it('父工具尚无 terminal result 时从正式 summary 接纳唯一 child 身份', () => {
    expect(projectSingleSubrunPresentation(input({
      subrunSummary: {
        subrun_ids: ['subrun-live'],
        event_counts: { 'subrun-live': 1 },
      },
    }))).toEqual({
      data: {
        description: '整理材料',
        status: 'loading',
        subagentType: 'general',
        subrunId: 'subrun-live',
      },
      title: {
        text: {
          key: 'conversation.tool.subrun.title',
          fallback: '子任务 · {description}',
          params: { description: '整理材料' },
        },
      },
    });
  });

  it('terminal result 与 summary 必须声明同一个 child', () => {
    expect(() => projectSingleSubrunPresentation(input({
      status: 'success',
      phase: 'complete',
      subrunSummary: {
        subrun_ids: ['subrun-summary'],
        event_counts: { 'subrun-summary': 2 },
      },
      result: {
        data: {
          description: '整理材料',
          subagent_type: 'general',
          model_id: 'model-subagent-test',
          subrun_ids: ['subrun-result'],
          status: 'completed',
          final_answer: '完成',
          artifacts: [],
        },
        observation: '完成',
      },
    }))).toThrow('[SUBRUN_SINGLE_IDENTITY_CONFLICT]');
  });

  it('拒绝退役工具名进入 canonical subagent 展示入口', () => {
    expect(() => projectSingleSubrunPresentation(input({
      sourceToolName: 'delegate',
      uiKey: 'delegate',
    }))).toThrow('Unsupported single subrun presentation');
  });
});
