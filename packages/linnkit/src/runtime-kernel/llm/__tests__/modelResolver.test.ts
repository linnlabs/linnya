import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelCatalogLike } from '../modelCatalog';
import { ModelResolver } from '../modelResolver';
import { EMPTY_MODEL_INPUT_REQUIREMENT } from '../input-capabilities';

const mockGetModelsByCapability = vi.fn();
const mockGetModelsByUIVisibility = vi.fn();

function createModelCatalog(): ModelCatalogLike {
  return {
    getModelById: vi.fn(),
    getModelsByCapability: mockGetModelsByCapability,
    getModelsByUIVisibility: mockGetModelsByUIVisibility,
  };
}

describe('ModelResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetModelsByUIVisibility.mockReturnValue([]);
    mockGetModelsByCapability.mockReturnValue([]);
  });

  it('优先返回显式传入的 modelId', () => {
    const resolver = new ModelResolver({ modelCatalog: createModelCatalog() });
    expect(resolver.resolveModelId('custom-model')).toBe('custom-model');
  });

  it('未传 modelId 时优先选择 ui_visibility=chat 的默认聊天模型', () => {
    mockGetModelsByUIVisibility.mockReturnValue([
      { id: 'ui-chat-model', enabled: true },
    ]);
    mockGetModelsByCapability.mockReturnValue([
      { id: 'capability-chat-model', enabled: true },
    ]);

    const resolver = new ModelResolver({ modelCatalog: createModelCatalog() });
    expect(resolver.resolveModelId()).toBe('ui-chat-model');
  });

  it('pickFallbackChatModel 应优先使用配置的 preferred order', () => {
    mockGetModelsByCapability.mockReturnValue([
      { id: 'fallback-a', enabled: true, capabilities: ['chat'], api_key: 'key-a' },
      { id: 'fallback-b', enabled: true, capabilities: ['chat'], api_key: 'key-b' },
    ]);

    const resolver = new ModelResolver({
      fallbackModelPreferredOrder: ['fallback-b', 'fallback-a'],
      modelCatalog: createModelCatalog(),
    });

    expect(resolver.pickFallbackChatModel(new Set<string>(), EMPTY_MODEL_INPUT_REQUIREMENT)).toBe('fallback-b');
  });

  it('pickFallbackChatModel 在没有 preferred 命中时保留 catalog 顺序', () => {
    mockGetModelsByCapability.mockReturnValue([
      { id: 'fallback-first', enabled: true, capabilities: ['chat'], api_key: 'key-a' },
      { id: 'fallback-second', enabled: true, capabilities: ['chat'], api_key: 'key-b' },
    ]);

    const resolver = new ModelResolver({ modelCatalog: createModelCatalog() });

    expect(resolver.pickFallbackChatModel(new Set<string>(), EMPTY_MODEL_INPUT_REQUIREMENT)).toBe('fallback-first');
  });
});
