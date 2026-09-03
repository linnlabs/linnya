import type { LanguageInferenceRouteProfileId } from '@app/schemas/model-inference';

export type ConfigurableLanguageRouteProfileId = Extract<
  LanguageInferenceRouteProfileId,
  | 'openai_chat'
  | 'openai_compatible_chat'
  | 'openai_responses'
  | 'anthropic_messages'
  | 'google_generative_ai'
  | 'deepseek_chat'
  | 'minimax_chat'
  | 'moonshot_chat'
  | 'alibaba_chat'
>;
