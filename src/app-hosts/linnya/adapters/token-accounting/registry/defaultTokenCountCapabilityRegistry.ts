import type { TokenCountCapability } from '../definitions/tokenCountCapability';
import { ANTHROPIC_TOKEN_COUNT_CAPABILITY } from '../functions/anthropicTokenCountCapability';
import { GEMINI_TOKEN_COUNT_CAPABILITY } from '../functions/geminiTokenCountCapability';
import { ZAI_TOKEN_COUNT_CAPABILITY } from '../functions/zaiTokenCountCapability';

const DEFAULT_CAPABILITIES: Readonly<Record<string, TokenCountCapability>> = Object.freeze({
  'token-count:anthropic-messages': ANTHROPIC_TOKEN_COUNT_CAPABILITY,
  'token-count:gemini-generate-content': GEMINI_TOKEN_COUNT_CAPABILITY,
  'token-count:zai-tokenizer': ZAI_TOKEN_COUNT_CAPABILITY,
});

export function resolveDefaultTokenCountCapability(capabilityId: string): TokenCountCapability {
  const capability = DEFAULT_CAPABILITIES[capabilityId];
  if (!capability) {
    throw new Error(`[TokenAccounting] capabilityId=${capabilityId} 没有已注册的 remote count capability。`);
  }
  return capability;
}
