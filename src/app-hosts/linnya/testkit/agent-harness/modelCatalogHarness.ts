import type { llm } from 'linnkit/runtime-kernel';

export const SCRIPTED_MODEL_ID = 'scripted-test-model';

/**
 * Host testkit 也必须提供正式 route 容量，不能绕过生产 context admission。
 */
export function createScriptedChatModelCatalog(
  modelId: string = SCRIPTED_MODEL_ID,
): llm.ModelCatalogLike {
  const entry: llm.ModelCatalogEntry = {
    id: modelId,
    enabled: true,
    api_key: 'scripted-fixture-key',
    capabilities: ['chat'],
    inference_route: {
      context_window_tokens: 256_000,
      max_output_tokens: 8_192,
    },
  };
  return {
    getModelById: id => (id === modelId ? entry : undefined),
    getModelsByCapability: capability => (capability === 'chat' ? [entry] : []),
    getModelsByUIVisibility: () => [],
  };
}
