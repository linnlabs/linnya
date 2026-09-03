import { describe, expect, it } from 'vitest';
import { buildConversationSubrunBatchArgs } from './buildConversationSubrunBatchArgs';

describe('buildConversationSubrunBatchArgs', () => {
  it('单个和批量使用同一 subruns 数组契约并生成宿主身份', () => {
    let id = 0;
    const args = buildConversationSubrunBatchArgs({
      request: {
        pluginId: 'fixture-plugin',
        workerId: 'item-research',
        prompt: 'Research items',
        activityFeature: 'fixture_research',
        subruns: [
          { description: 'Node A', prompt: 'Research A' },
          { description: 'Node B', prompt: 'Research B' },
        ],
      },
      workerPromptKey: 'fixture_item_research',
      createId: () => String(++id),
    });

    expect(args).toEqual({
      worker_prompt_key: 'fixture_item_research',
      subruns: [
        {
          unit_id: 'subrun-unit-1',
          subrun_id: 'subrun-2',
          description: 'Node A',
          prompt: 'Research A',
        },
        {
          unit_id: 'subrun-unit-3',
          subrun_id: 'subrun-4',
          description: 'Node B',
          prompt: 'Research B',
        },
      ],
    });
  });

  it('拒绝空 subrun 列表与空描述', () => {
    const base = {
      pluginId: 'fixture-plugin',
      workerId: 'item-research',
      prompt: 'Research items',
      activityFeature: 'fixture_research',
    } as const;
    expect(() => buildConversationSubrunBatchArgs({
      request: { ...base, subruns: [] },
      workerPromptKey: 'worker',
      createId: () => 'id',
    })).toThrow();
    expect(() => buildConversationSubrunBatchArgs({
      request: { ...base, subruns: [{ description: '', prompt: 'Research' }] },
      workerPromptKey: 'worker',
      createId: () => 'id',
    })).toThrow();
  });
});
