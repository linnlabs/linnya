import { describe, expect, it } from 'vitest';
import { buildSubrunBatchCollectionItems } from '../functions/buildSubrunBatchCollectionItems';

const subruns = [
  { unit_id: 'unit-a', subrun_id: 'subrun-a', description: '任务 A', prompt: '执行 A' },
  { unit_id: 'unit-b', subrun_id: 'subrun-b', description: '任务 B', prompt: '执行 B' },
  { unit_id: 'unit-c', subrun_id: 'subrun-c', description: '任务 C', prompt: '执行 C' },
];

describe('buildSubrunBatchCollectionItems', () => {
  it('只有 decision 参数时就按输入顺序展示全部 loading 项', () => {
    const items = buildSubrunBatchCollectionItems({
      args: { worker_prompt_key: 'table_ai_fill', subruns },
      parentStatus: 'loading',
    });

    expect(items.map((item) => item.subrunId)).toEqual([
      'subrun-a',
      'subrun-b',
      'subrun-c',
    ]);
    expect(items.map((item) => item.presentation.data.description)).toEqual([
      '任务 A',
      '任务 B',
      '任务 C',
    ]);
    expect(items.every((item) => item.presentation.data.status === 'loading')).toBe(true);
  });

  it('结果不得引入 decision 参数未声明的 child 身份', () => {
    expect(() => buildSubrunBatchCollectionItems({
      args: { worker_prompt_key: 'table_ai_fill', subruns },
      result: {
        data: {
          status: 'completed',
          total: 1,
          succeeded: 1,
          failed: 0,
          cancelled: 0,
          subrun_ids: ['external-subrun'],
          results: [{
            unit_id: 'external-unit',
            subrun_id: 'external-subrun',
            description: '未知任务',
            status: 'completed',
            final_answer: '完成',
          }],
        },
        observation: '完成',
      },
      parentStatus: 'success',
    })).toThrow('[SUBRUN_BATCH_IDENTITY_CONFLICT]');
  });

  it('完成后使用结果中的权威顺序，并保留成功、失败和取消事实', () => {
    const items = buildSubrunBatchCollectionItems({
      args: { worker_prompt_key: 'table_ai_fill', subruns },
      result: {
        data: {
          status: 'partial',
          total: 3,
          succeeded: 1,
          failed: 1,
          cancelled: 1,
          subrun_ids: ['subrun-c', 'subrun-a', 'subrun-b'],
          results: [
            {
              unit_id: 'unit-c',
              subrun_id: 'subrun-c',
              description: '任务 C',
              status: 'completed',
              final_answer: '结果 C',
            },
            {
              unit_id: 'unit-a',
              subrun_id: 'subrun-a',
              description: '任务 A',
              status: 'failed',
              final_answer: '',
              error: '任务 A 失败',
            },
            {
              unit_id: 'unit-b',
              subrun_id: 'subrun-b',
              description: '任务 B',
              status: 'cancelled',
              final_answer: '',
            },
          ],
        },
        observation: '批量任务结束。',
      },
      parentStatus: 'success',
    });

    expect(items.map((item) => item.subrunId)).toEqual(['subrun-c', 'subrun-a', 'subrun-b']);
    expect(items.map((item) => item.presentation.data.status)).toEqual([
      'success',
      'error',
      'error',
    ]);
    expect(items.map((item) => item.presentation.data.description)).toEqual([
      '任务 C',
      '任务 A',
      '任务 B',
    ]);
  });
});
