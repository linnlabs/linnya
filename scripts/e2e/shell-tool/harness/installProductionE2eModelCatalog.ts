import type { llm } from '@linnlabs/linnkit/runtime-kernel';
import { modelCatalog } from '../../../../src/domains/model-catalog';
import { createScriptedChatModelCatalog } from '../../../../src/app-hosts/linnya/testkit/agent-harness/modelCatalogHarness';

/**
 * 每个 packaged 场景独占一个进程。测试模型同时进入真实 Host 目录和 scripted 推理器，
 * 让持久化 Run 的准入快照读取同一模型事实；账号投影只驻留内存，不写用户目录或访问钥匙串。
 */
export function installProductionE2eModelCatalog(modelId: string): llm.ModelCatalogLike {
  const scriptedCatalog = createScriptedChatModelCatalog(modelId);
  const route = scriptedCatalog.getModelById(modelId)?.inference_route;
  if (!route) throw new Error(`Scripted model route missing: ${modelId}`);

  const accountId = `e2e:${modelId}`;
  modelCatalog.replaceAccountModels(accountId, [{
    id: modelId,
    model_name: modelId,
    catalog_source: 'account',
    credential_reference: { kind: 'provider_account', account_id: accountId },
    capabilities: ['chat'],
    ui_visibility: ['user'],
    display_name: 'Scripted E2E model',
    description: 'In-process deterministic inference fixture',
    inference_route: {
      ...route,
      api_surface: 'openai_chat_completions',
      capability_id: 'ai-sdk:openai-chat',
      endpoint_id: 'scripted-e2e',
      endpoint_model_id: modelId,
      base_url: 'https://models.example.com/v1',
      auth_profile: 'bearer',
      input_support: { user_image: false, tool_result_image: false },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'optional' },
    },
  }]);
  return scriptedCatalog;
}
