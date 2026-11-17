import { describe, expect, it, vi } from 'vitest';
import type { SettingsMessageResolver } from '@/domains/settings/public';
import type { EmbeddingModelChangeImpactPort } from '../ports/embeddingModelChangeImpactPort';
import {
  confirmEmbeddingModelSelection,
  confirmEmbeddingRouteEdit,
} from './confirmEmbeddingRouteEdit';

const message: SettingsMessageResolver = (key, values) => `${key}:${JSON.stringify(values ?? {})}`;
const item = { id: 'kb', name: 'Notes', documentCount: 2 };
function setup() {
  const impact: EmbeddingModelChangeImpactPort = {
    findKnowledgeBasesUsingModel: vi.fn(async () => [item]),
    findImpactedKnowledgeBases: vi.fn(async () => [item]),
  };
  const confirm = vi.fn<typeof import('@shared/composables/confirmDialog').confirm>(
    async () => false
  );
  return { impact, confirm };
}

describe('嵌入模型编辑影响确认', () => {
  it('列出且去重实际受影响库，取消保留配置；无影响无需打扰', async () => {
    const deps = setup();
    expect(await confirmEmbeddingRouteEdit(['a', 'b'], message, deps)).toBe(false);
    expect(deps.confirm.mock.calls[0]?.[0]).toMatchObject({
      message: expect.stringContaining('"count":1'),
    });
    vi.mocked(deps.impact.findKnowledgeBasesUsingModel).mockResolvedValue([]);
    expect(await confirmEmbeddingRouteEdit(['unused'], message, deps)).toBe(true);
    expect(deps.confirm).toHaveBeenCalledOnce();
  });
  it('插件未启用或metadata不可读明确未知，不冒认零影响；用途切换同一边界', async () => {
    const deps = setup();
    await confirmEmbeddingRouteEdit(['a'], message, { ...deps, impact: null });
    expect(deps.confirm.mock.calls[0]?.[0]).toMatchObject({
      message: expect.stringContaining('unavailable'),
    });
    vi.mocked(deps.impact.findImpactedKnowledgeBases).mockRejectedValue(
      new Error('metadata offline')
    );
    await confirmEmbeddingModelSelection('next', message, deps);
    expect(deps.confirm.mock.calls[1]?.[0]).toMatchObject({
      message: expect.stringContaining('unavailable'),
    });
  });
});
