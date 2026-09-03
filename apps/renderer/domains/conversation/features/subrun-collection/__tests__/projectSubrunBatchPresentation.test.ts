import { describe, expect, it } from 'vitest';

import { projectSubrunBatchPresentation } from '../functions/projectSubrunBatchPresentation';

describe('projectSubrunBatchPresentation', () => {
  it('在组件挂载前把 batch raw payload 投影成 presentation-only items', () => {
    const projected = projectSubrunBatchPresentation({
      sourceToolName: 'subrun_batch',
      uiKey: 'subrun_batch',
      args: {
        worker_prompt_key: 'table_fill',
        subruns: [{
          unit_id: 'unit-a',
          subrun_id: 'subrun-a',
          description: '填写 A',
          prompt: '执行 A',
        }],
      },
      result: undefined,
      status: 'loading',
      phase: 'start',
    });

    expect(projected.data.items).toEqual([{
      subrunId: 'subrun-a',
      presentation: {
        status: 'loading',
        data: {
          description: '填写 A',
          status: 'loading',
          subrunId: 'subrun-a',
        },
      },
    }]);
    expect(projected.title).toEqual({
      text: {
        key: 'conversation.tool.subrun.batchTitle',
        fallback: '并行子任务 · {count} 个',
        params: { count: 1 },
      },
    });
  });
});
