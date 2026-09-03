import { describe, expect, it } from 'vitest';

import type { ToolCallMessage } from '../../../types';
import { projectSubrunDetailFooterPresentation } from './projectSubrunDetailFooterPresentation';

function parentMessage(
  lifecycle: 'loading' | 'success' | 'error',
): ToolCallMessage {
  const terminal = lifecycle !== 'loading';
  return {
    id: 'message-parent-subagent',
    role: 'assistant',
    type: 'tool_calls',
    content: lifecycle === 'success' ? '子任务完成' : lifecycle === 'error' ? '子任务失败' : '执行中',
    timestamp: 1,
    metadata: {
      tool_call_id: 'call-parent-subagent',
      tool_name: 'subagent',
      status: lifecycle,
      phase: lifecycle === 'loading' ? 'start' : lifecycle === 'success' ? 'complete' : 'error',
      args: { description: '读取报告', prompt: '读取并总结报告' },
      ...(lifecycle === 'success' ? {
        data: {
          description: '读取报告',
          subagent_type: 'general',
          model_id: 'cloud-model-1',
          subrun_ids: ['subrun-child'],
          status: 'completed',
          final_answer: '完成',
          artifacts: [],
        },
      } : {}),
      ...(lifecycle === 'error' ? { error: 'child failed' } : {}),
      turn_id: 'turn-parent',
      run_id: 'run-parent',
      started_at: 1,
      ...(terminal ? { completed_at: 2 } : {}),
    },
  };
}

describe('projectSubrunDetailFooterPresentation', () => {
  it('从 owner-admitted terminal result 投影真实模型与完成状态', () => {
    expect(projectSubrunDetailFooterPresentation({
      parentMessage: parentMessage('success'),
      subrunId: 'subrun-child',
    })).toEqual({
      status: 'completed',
      modelId: 'cloud-model-1',
    });
  });

  it('运行中与工具失败只消费父工具生命周期，不猜当前模型', () => {
    expect(projectSubrunDetailFooterPresentation({
      parentMessage: parentMessage('loading'),
      subrunId: 'subrun-child',
    })).toEqual({ status: 'running' });
    expect(projectSubrunDetailFooterPresentation({
      parentMessage: parentMessage('error'),
      subrunId: 'subrun-child',
    })).toEqual({ status: 'failed' });
  });

  it('拒绝把另一条 child 的终态展示到当前详情', () => {
    expect(() => projectSubrunDetailFooterPresentation({
      parentMessage: parentMessage('success'),
      subrunId: 'subrun-other',
    })).toThrow('[SUBRUN_DETAIL_RESULT_IDENTITY_CONFLICT]');
  });
});
