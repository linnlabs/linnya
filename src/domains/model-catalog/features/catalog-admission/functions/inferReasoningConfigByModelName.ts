/**
 * @file src/domains/model-catalog/features/catalog-admission/functions/inferReasoningConfigByModelName.ts
 *
 * @description
 * 按「模型名」推断常见 reasoning 模型的思考努力程度能力契约。
 *
 * 设计要点：
 * - 用户要求「支持所有常见模型，而不是根据云端来搞」：本函数对所有来源的模型
 *   （本地 default_models.json / 云端 /v1/models / 用户自配）统一生效，
 *   调用点在 `processModelConfig()`，且「显式契约优先，推断兜底」——
 *   模型若显式声明了 `reasoning`，以显式值为准；未声明才按 model_name 推断。
 * - 只输出「支持哪些档位 / 默认档位」，不输出 Provider 私有 summary、token budget
 *   或 API 字段；请求体字段形态由 adapter 身份隐含表达（plan §0.2 第1点）。
 * - 固定思考模型（如 deepseek-reasoner / r1，原生不支持档位调节）不补契约，
 *   前端不展示控件、adapter 不发字段，这是正确的「不支持就不暴露」行为；
 *   DeepSeek V4（v4-pro/flash）支持 reasoning_effort + thinking toggle，单独配契约。
 *
 * 档位事实来源：各 provider 公开 API 文档；当前产品取舍直接记录在对应模型分支的注释中。
 */

import type { ModelReasoningConfig } from '@linnlabs/linnkit/contracts';

/**
 * 按模型名推断 reasoning 能力契约。
 *
 * @param modelName 模型名（如 `gpt-5`、`anthropic/claude-opus-4-20250514`、`google/gemini-2.5-pro`）
 * @returns 推断出的契约；若该模型不是已知 reasoning 模型，返回 undefined
 */
export function inferReasoningConfigByModelName(modelName: string): ModelReasoningConfig | undefined {
  const name = modelName.toLowerCase();

  // GPT-5 全系列：统一 off/low/medium/high/xhigh
  //
  // 产品决策：UI 一致优先，不区分版本（用户要求「低中高最高，无极低」）。
  // 技术权衡：原版 gpt-5（2025-08-07）和 gpt-5.1 的 API 不支持 xhigh，
  //   用户选「最高」时 OpenAI 会返回 400；gpt-5.2+ 全档位支持。
  //   该权衡由产品确认接受，不在此处做版本降级（避免 adapter 需要感知模型版本）。
  // 匹配 gpt-5、gpt5、gpt-5-mini、gpt-5-nano、gpt-5.1、gpt-5.2、gpt-5.5、openai/gpt-5 等
  if (/gpt-?5/.test(name)) {
    return {
      supported_efforts: ['off', 'low', 'medium', 'high', 'xhigh'],
      default_effort: 'medium',
    };
  }

  // OpenAI o 系列 reasoning 模型（o1 / o3 / o4-mini）：走 Chat Completions，reasoning_effort 顶层字段
  // o1 支持 minimal/low/medium/high；o3/o4-mini 支持 low/medium/high。统一保守取 low/medium/high。
  // 匹配 o1、o3、o4-mini、o1-mini、openai/o3 等（注意排除普通模型名里偶发 o3 片段，要求 o 后紧跟 1/3/4）
  if (/\bo[134]/.test(name)) {
    return {
      supported_efforts: ['low', 'medium', 'high'],
      default_effort: 'medium',
    };
  }

  // Claude 3.7+ / 4 系列 extended thinking
  // 匹配 claude-3.7-sonnet、claude-3-7-sonnet、anthropic/claude-opus-4-...、claude-sonnet-4-...、claude-haiku-4-5-...
  if (/claude-(3[.-]7|opus-4|sonnet-4|haiku-4)/.test(name)) {
    return {
      supported_efforts: ['off', 'low', 'medium', 'high'],
      default_effort: 'medium',
    };
  }

  // Gemini 2.5+ / 3+ 系列：走 thinkingConfig
  // 匹配 gemini-2.5-pro、gemini-2-5-flash、google/gemini-3-pro、gemini-3-flash-preview 等
  if (/gemini-(2[.-]5|3)/.test(name)) {
    return {
      supported_efforts: ['off', 'low', 'medium', 'high'],
      default_effort: 'medium',
    };
  }

  // Qwen3 thinking 系列：走 enable_thinking + thinking_budget
  // 匹配 qwen3-235b-a22b-thinking-2507、qwen3-30b-a3b-thinking-2507 等
  if (/qwen3[\w-]*thinking/.test(name)) {
    return {
      supported_efforts: ['off', 'low', 'medium', 'high'],
      default_effort: 'medium',
    };
  }

  // Grok reasoning 系列：grok-3-mini / grok-4 支持 reasoning_effort
  if (/grok-(3-mini|4)/.test(name)) {
    return {
      supported_efforts: ['low', 'medium', 'high'],
      default_effort: 'medium',
    };
  }

  // DeepSeek V4 系列（deepseek-v4-pro / deepseek-v4-flash）：走 OpenAI 兼容 Chat Completions
  // DeepSeek V4 文档：reasoning_effort 只认 high/max；low/medium 被映射到 high，xhigh 映射到 max；
  // thinking:{type:"disabled"} 关闭思考。暴露全档位让降级链有落点，adapter 做值映射。
  // default high（DeepSeek V4 默认 thinking enabled + effort high）。
  if (/deepseek-v4/.test(name)) {
    return {
      supported_efforts: ['off', 'low', 'medium', 'high', 'xhigh'],
      default_effort: 'high',
    };
  }

  // GLM-5.3 / GLM-5.3-Flash（Ollama Cloud）：原生思考始终开启，支持 low/high/max。
  // 当前 ai-sdk-ollama 的已验证合同只接受 low/medium/high；canonical xhigh 会映射为
  // Ollama high，因此这里不把 max/medium 虚假暴露给前端，先公开实际可区分的 low/high。
  if (/glm-5\.3(?:-flash)?(?:$|[:/])/.test(name)) {
    return {
      supported_efforts: ['low', 'high'],
      default_effort: 'high',
    };
  }

  // deepseek-reasoner / r1 / r1-0528 / deepseek-chat 等不补契约：
  // - reasoner/r1 固定思考，原生不支持档位调节；
  // - chat 非 reasoning 模型。
  // 前端不展示控件、adapter 不发字段，这是正确的「不支持就不暴露」行为。
  return undefined;
}
