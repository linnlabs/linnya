import { describe, expect, it } from 'vitest';
import {
  readSubrunBatchArgs,
  readSubrunBatchData,
  readSubrunBatchStructuredResult,
} from '../src/tools/subrun-batch';

describe('subrun batch shared contract', () => {
  it('reads explicit subrun identities and a consistent ordered result', () => {
    const args = readSubrunBatchArgs({
      worker_prompt_key: 'table_ai_fill',
      subruns: [
        {
          unit_id: 'unit-1',
          subrun_id: 'subrun-1',
          description: '第一项',
          prompt: '处理第一项',
        },
      ],
    });
    const result = readSubrunBatchStructuredResult({
      data: {
        status: 'completed',
        total: 1,
        succeeded: 1,
        failed: 0,
        cancelled: 0,
        subrun_ids: ['subrun-1'],
        results: [
          {
            unit_id: 'unit-1',
            subrun_id: 'subrun-1',
            description: '第一项',
            status: 'completed',
            final_answer: '结果一',
          },
        ],
      },
      observation: '批量子任务完成：1/1 成功，0 失败。',
    });

    expect(args).toMatchObject({
      worker_prompt_key: 'table_ai_fill',
      subruns: [{ unit_id: 'unit-1', subrun_id: 'subrun-1' }],
    });
    expect(result?.data.subrun_ids).toEqual(['subrun-1']);
  });

  it('rejects duplicate identities and result counters that do not match items', () => {
    expect(readSubrunBatchArgs({
      worker_prompt_key: 'table_ai_fill',
      subruns: [
        { unit_id: 'same', subrun_id: 'subrun-1', description: '第一项', prompt: '一' },
        { unit_id: 'same', subrun_id: 'subrun-2', description: '第二项', prompt: '二' },
      ],
    })).toBeNull();

    expect(readSubrunBatchArgs({
      subruns: [
        { unit_id: 'unit-1', subrun_id: 'subrun-1', description: '第一项', prompt: '一' },
      ],
    })).toBeNull();

    expect(readSubrunBatchData({
      status: 'partial',
      total: 2,
      succeeded: 2,
      failed: 0,
      cancelled: 0,
      subrun_ids: ['subrun-1', 'subrun-2'],
      results: [
        {
          unit_id: 'unit-1',
          subrun_id: 'subrun-1',
          description: '第一项',
          status: 'completed',
          final_answer: '一',
        },
        {
          unit_id: 'unit-2',
          subrun_id: 'subrun-2',
          description: '第二项',
          status: 'failed',
          final_answer: '',
          error: '失败',
        },
      ],
    })).toBeNull();
  });
});
