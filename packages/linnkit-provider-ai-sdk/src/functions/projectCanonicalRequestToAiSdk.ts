import { jsonSchema, tool, type ToolChoice, type ToolSet } from 'ai';
import type { SharedV4ProviderOptions as ProviderOptions } from '@ai-sdk/provider';
import type { CanonicalInferenceRequest } from '@linnlabs/linnkit/ports';
import { AI_SDK_INFERENCE_CAPABILITY_IDS } from '../definitions/aiSdkCapabilityIds';
import {
  CHATGPT_CODEX_REQUEST_PROFILE_ID,
  type AiSdkInferenceRoute,
} from '../definitions/aiSdkInferenceSurface';

export interface AiSdkToolConfiguration {
  readonly tools?: ToolSet;
  readonly toolChoice?: ToolChoice<ToolSet>;
}

/**
 * Linnkit 已经拥有 durable history，Responses 请求必须使用无状态回放。
 *
 * AI SDK/OpenAI 默认 `store=true`，会把带 item ID 的历史压成 `item_reference`。这要求下一跳
 * 持有 OpenAI 服务端会话状态，普通 Responses-compatible 网关无法保证该语义。显式关闭服务端
 * 存储后，官方 package 会使用 canonical history 中保存的完整 item 与 encrypted reasoning 重建请求。
 */
export function projectAiSdkRequestProviderOptions(
  request: CanonicalInferenceRequest,
  route: AiSdkInferenceRoute,
): ProviderOptions | undefined {
  if (route.surface !== 'openai_responses') return undefined;
  switch (route.capability_id) {
    case AI_SDK_INFERENCE_CAPABILITY_IDS.OPENAI_RESPONSES: {
      if (route.request_profile === CHATGPT_CODEX_REQUEST_PROFILE_ID) {
        const instructions = request.messages
          .filter(message => message.role === 'system')
          .map(message => message.content)
          .join('\n\n');
        return {
          openai: {
            store: false,
            ...(instructions ? { instructions } : {}),
            systemMessageMode: 'remove',
            strictJsonSchema: false,
            parallelToolCalls: true,
            textVerbosity: 'low',
            ...(request.sampling.reasoning_effort !== undefined &&
              request.sampling.reasoning_effort !== 'none'
              ? { reasoningSummary: 'auto' }
              : {}),
          },
        };
      }
      return { openai: { store: false } };
    }
    case AI_SDK_INFERENCE_CAPABILITY_IDS.XAI_RESPONSES:
      return { xai: { store: false } };
    default:
      throw new Error(
        `[AiSdkInference] ${route.capability_id} 不是已准入的 Responses request capability。`,
      );
  }
}

/**
 * ChatGPT Codex 账号后端不是普通 OpenAI API 产品。Host 仍用 Linnkit 输出预算做 admission，
 * 但按 Codex 客户端合同省略 wire max_output_tokens。
 */
export function projectAiSdkGenerationSettings(
  request: CanonicalInferenceRequest,
  route: AiSdkInferenceRoute,
): {
  readonly maxOutputTokens?: number;
  readonly reasoning?: CanonicalInferenceRequest['sampling']['reasoning_effort'];
} {
  const isChatGptCodex = route.request_profile === CHATGPT_CODEX_REQUEST_PROFILE_ID;
  return {
    ...(!isChatGptCodex && request.sampling.max_output_tokens !== undefined
      ? { maxOutputTokens: request.sampling.max_output_tokens }
      : {}),
    ...(request.sampling.reasoning_effort !== undefined &&
      (!isChatGptCodex || request.sampling.reasoning_effort !== 'none')
      ? { reasoning: request.sampling.reasoning_effort }
      : {}),
  };
}

/**
 * AI SDK 不接受“空工具集 + auto”组合，因此没有候选工具时省略整个工具配置。
 * 有候选工具时也省略 canonical auto，让具体 Provider package 决定自己的默认 wire；
 * `none`、`required` 和指定工具仍显式投影。
 */
export function projectCanonicalToolConfiguration(
  request: CanonicalInferenceRequest,
): AiSdkToolConfiguration {
  if (request.tools.length === 0) return {};

  const tools = Object.fromEntries(
    request.tools.map(definition => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: jsonSchema(definition.parameters),
      }),
    ]),
  );
  if (request.tool_choice === 'auto') {
    // auto 是 canonical 默认语义。省略字段让每个 Provider package 使用自己的默认值，
    // 避免把 OpenAI 风格的显式 tool_choice=auto 强加给不接受该 wire 的厂商。
    return { tools };
  }
  const toolChoice: ToolChoice<ToolSet> = typeof request.tool_choice === 'object'
    ? { type: 'tool', toolName: request.tool_choice.name }
    : request.tool_choice;
  return { tools, toolChoice };
}
