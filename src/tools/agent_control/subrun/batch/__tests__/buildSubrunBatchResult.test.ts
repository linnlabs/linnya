import { describe, expect, it } from 'vitest';
import { buildSubrunBatchResult } from '../functions/buildSubrunBatchResult';

describe('buildSubrunBatchResult', () => {
  it('associates child results by explicit subrun id while preserving subrun order', () => {
    const longAnswer = 'a'.repeat(1_200);
    const result = buildSubrunBatchResult({
      subruns: [
        { unit_id: 'unit-1', subrun_id: 'subrun-1', description: '第一项', prompt: '处理第一项' },
        { unit_id: 'unit-2', subrun_id: 'subrun-2', description: '第二项', prompt: '处理第二项' },
        { unit_id: 'unit-3', subrun_id: 'subrun-3', description: '第三项', prompt: '处理第三项' },
      ],
      childResults: [
        { subrunId: 'subrun-3', success: true, finalAnswer: '结果三' },
        { subrunId: 'subrun-1', success: true, finalAnswer: longAnswer },
        { subrunId: 'subrun-2', success: false, finalAnswer: '', error: '第二项失败' },
      ],
    });

    expect(result.data).toMatchObject({
      status: 'partial',
      total: 3,
      succeeded: 2,
      failed: 1,
      cancelled: 0,
      subrun_ids: ['subrun-1', 'subrun-2', 'subrun-3'],
    });
    expect(result.data.results.map((item) => item.status)).toEqual(['completed', 'failed', 'completed']);
    expect(result.data.results[0]?.final_answer).toBe(longAnswer);
    expect(result.observation).toContain('批量子任务完成：2/3 成功，1 失败。');
    expect(result.observation).not.toContain(longAnswer);
    expect(result.observation).not.toContain('unit-1');
    expect(result.observation).not.toContain('subrun-1');
  });

  it('keeps cancellation distinct from business failure', () => {
    const result = buildSubrunBatchResult({
      subruns: [
        { unit_id: 'unit-1', subrun_id: 'subrun-1', description: '第一项', prompt: '处理第一项' },
      ],
      childResults: [
        {
          subrunId: 'subrun-1',
          success: false,
          cancelled: true,
          finalAnswer: '',
          error: '用户取消',
        },
      ],
    });

    expect(result.data).toMatchObject({
      status: 'cancelled',
      succeeded: 0,
      failed: 0,
      cancelled: 1,
    });
    expect(result.data.results[0]?.status).toBe('cancelled');
    expect(result.observation).toContain('0 失败，1 取消');
  });

  it('rejects missing or duplicate child identities', () => {
    const subruns = [
      { unit_id: 'unit-1', subrun_id: 'subrun-1', description: '第一项', prompt: '处理第一项' },
      { unit_id: 'unit-2', subrun_id: 'subrun-2', description: '第二项', prompt: '处理第二项' },
    ];

    expect(() => buildSubrunBatchResult({
      subruns,
      childResults: [
        { subrunId: 'subrun-1', success: true, finalAnswer: '一' },
        { subrunId: 'subrun-1', success: true, finalAnswer: '重复' },
      ],
    })).toThrow('duplicate child result');

    expect(() => buildSubrunBatchResult({
      subruns,
      childResults: [
        { subrunId: 'subrun-1', success: true, finalAnswer: '一' },
      ],
    })).toThrow('child result count does not match subrun count');
  });
});
