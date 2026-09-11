/**
 * @file inferModelCapabilitiesById.ts
 * @description 根据模型名称/ID 启发式推断模型能力（视觉支持、上下文窗口大小、最大输出 token）。
 * 当端点（如标准 OpenAI /v1/models）仅返回 ID 而不暴露具体参数时，为用户提供智能默认值。
 */

export interface InferredModelCapabilities {
  readonly context_window_tokens?: number;
  readonly max_output_tokens?: number;
  readonly supports_image_input?: boolean;
}

/**
 * 根据 modelId 推断上下文窗口（单位 tokens）
 */
export function inferContextWindowByModelId(modelId: string): number | undefined {
  const id = modelId.toLowerCase();

  // 显式带 k / m 后缀模式，如 qwen2.5-72b-128k, llama-3-8b-32k, deepseek-v2.5-64k
  const explicitKMatch = id.match(/[-_](\d+)k(?:\b|[-_])/);
  if (explicitKMatch) {
    const kValue = parseInt(explicitKMatch[1], 10);
    if (kValue > 0 && kValue <= 2048) {
      return kValue * 1024;
    }
  }

  const explicitMMatch = id.match(/[-_](\d+)m(?:\b|[-_])/);
  if (explicitMMatch) {
    const mValue = parseInt(explicitMMatch[1], 10);
    if (mValue > 0 && mValue <= 10) {
      return mValue * 1024 * 1024;
    }
  }

  // 常见已知主流模型家族规则
  // Gemini 1.5 / 2.0 / 2.5: 1M ~ 2M
  if (id.includes('gemini-1.5') || id.includes('gemini-2')) {
    return 1048576; // 1M tokens
  }

  // Claude 3 / 3.5 / 3.7: 200k
  if (id.includes('claude-3') || id.includes('claude-3-5') || id.includes('claude-3.5') || id.includes('claude-3-7')) {
    return 200000;
  }

  // GPT-4o, GPT-4o-mini, o1, o3, o3-mini, GPT-4-turbo: 128k
  if (
    id.includes('gpt-4o') ||
    id.includes('gpt-4-turbo') ||
    id.includes('o1') ||
    id.includes('o3') ||
    id.includes('gpt-5') ||
    id.includes('gpt-6')
  ) {
    return 128000;
  }

  // DeepSeek-V3 / DeepSeek-R1 / DeepSeek-Coder: 64k ~ 128k (官方 64k/128k)
  if (id.includes('deepseek')) {
    return 64000;
  }

  // Qwen 2.5 系列 (默认 128k，常见 32k/128k)
  if (id.includes('qwen-2.5') || id.includes('qwen2.5') || id.includes('qwq')) {
    return 128000;
  }

  // Llama 3.1 / 3.2 / 3.3 系列: 128k
  if (id.includes('llama-3.1') || id.includes('llama-3.2') || id.includes('llama-3.3') || id.includes('llama3.1') || id.includes('llama3.2') || id.includes('llama3.3')) {
    return 128000;
  }

  // Llama 3 早期版本: 8k
  if (id.includes('llama-3') || id.includes('llama3')) {
    return 8192;
  }

  // 兜底 32k 或 undefined（让调用方决定 fallback 默认值，如 32768 或 16384）
  return undefined;
}

/**
 * 根据 modelId 推断最大输出 tokens
 */
export function inferMaxOutputTokensByModelId(modelId: string): number | undefined {
  const id = modelId.toLowerCase();

  // Reasoning 模型通常支持超大输出 tokens (思维链 + 回答)
  if (id.includes('o1') || id.includes('o3') || id.includes('r1') || id.includes('qwq') || id.includes('reasoner')) {
    if (id.includes('o3-mini') || id.includes('o1-mini')) return 65536;
    if (id.includes('deepseek-r1') || id.includes('deepseek-reasoner')) return 8192;
    return 32768;
  }

  // Claude 3.5 Sonnet / 3.7: 8192
  if (id.includes('claude-3-5') || id.includes('claude-3.5') || id.includes('claude-3-7')) {
    return 8192;
  }

  // GPT-4o: 4096 (或新版本 16384)
  if (id.includes('gpt-4o')) {
    return 4096;
  }

  // DeepSeek-V3: 8192
  if (id.includes('deepseek')) {
    return 8192;
  }

  // Qwen 2.5: 8192
  if (id.includes('qwen-2.5') || id.includes('qwen2.5')) {
    return 8192;
  }

  // 默认常用输出上限 4096
  return 4096;
}

/**
 * 根据 modelId 推断是否支持图片/多模态输入
 */
export function inferImageInputSupportByModelId(modelId: string): boolean {
  const id = modelId.toLowerCase();

  // 视觉专有关键词
  if (
    id.includes('vision') ||
    id.includes('-vl') ||
    id.includes('vl-') ||
    id.includes('multimodal') ||
    id.includes('omni') ||
    id.includes('4o')
  ) {
    return true;
  }

  // Claude 3 全系列支持视觉
  if (id.includes('claude-3')) {
    return true;
  }

  // Gemini 全系列原生多模态
  if (id.includes('gemini')) {
    return true;
  }

  // Qwen-VL 系列
  if (id.includes('qwen') && (id.includes('vl') || id.includes('vision'))) {
    return true;
  }

  // Llama 3.2 11B / 90B 视觉模型
  if (id.includes('llama-3.2') && (id.includes('11b') || id.includes('90b') || id.includes('vision'))) {
    return true;
  }

  return false;
}

/**
 * 汇总推断结果
 */
export function inferModelCapabilitiesById(modelId: string): InferredModelCapabilities {
  return {
    context_window_tokens: inferContextWindowByModelId(modelId),
    max_output_tokens: inferMaxOutputTokensByModelId(modelId),
    supports_image_input: inferImageInputSupportByModelId(modelId),
  };
}
