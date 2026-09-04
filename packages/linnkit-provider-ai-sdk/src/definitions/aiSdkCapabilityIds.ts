export const AI_SDK_INFERENCE_CAPABILITY_IDS = {
  OPENAI_CHAT: 'ai-sdk:openai-chat',
  OPENAI_COMPATIBLE_CHAT: 'ai-sdk:openai-compatible',
  OPENAI_RESPONSES: 'ai-sdk:openai-responses',
  ANTHROPIC_MESSAGES: 'ai-sdk:anthropic-messages',
  GOOGLE_GENERATIVE_AI: 'ai-sdk:google-generative-ai',
  DEEPSEEK_CHAT: 'ai-sdk:deepseek',
  MINIMAX_CHAT: 'ai-sdk:minimax',
  MOONSHOT_CHAT: 'ai-sdk:moonshotai',
  ALIBABA_CHAT: 'ai-sdk:alibaba',
  MISTRAL_CHAT: 'ai-sdk:mistral',
  XAI_RESPONSES: 'ai-sdk:xai-responses',
  GROQ_CHAT: 'ai-sdk:groq',
  CEREBRAS_CHAT: 'ai-sdk:cerebras',
  OPENROUTER_CHAT: 'ai-sdk:openrouter',
  FIREWORKS_CHAT: 'ai-sdk:fireworks',
  TOGETHERAI_CHAT: 'ai-sdk:togetherai',
  DEEPINFRA_CHAT: 'ai-sdk:deepinfra',
  COHERE_CHAT: 'ai-sdk:cohere',
  ZAI_CHAT: 'ai-sdk:zai',
  OLLAMA_CHAT: 'ai-sdk:ollama',
} as const;

export type AiSdkInferenceCapabilityId =
  (typeof AI_SDK_INFERENCE_CAPABILITY_IDS)[keyof typeof AI_SDK_INFERENCE_CAPABILITY_IDS];

/** Adapter 产生且 Host routing policy 可以选择消费的稳定 failure code。 */
export const AI_SDK_MODEL_ROUTABLE_FAILURE_CODES = {
  PROVIDER_LOCATION_RESTRICTED: 'provider_location_restricted',
  PROVIDER_CONTINUATION_REJECTED: 'provider_continuation_rejected',
} as const;
