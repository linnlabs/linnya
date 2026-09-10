import {
  projectLanguageInferenceImageInputSupport,
  type LanguageInferenceImageInputSupport,
  type LanguageInferenceRouteProfileId,
} from '@app/schemas/model-inference';
import type { SettingsMessageKey } from '@/domains/settings/public';

import type { ConfigurableLanguageRouteProfileId } from '../definitions/configurableLanguageRouteProfile';

export const CONFIGURABLE_LANGUAGE_ROUTE_PROFILE_IDS = [
  'openai_chat',
  'openai_compatible_chat',
  'openai_responses',
  'anthropic_messages',
  'google_generative_ai',
  'deepseek_chat',
  'minimax_chat',
  'moonshot_chat',
  'alibaba_chat',
] as const satisfies readonly ConfigurableLanguageRouteProfileId[];

export interface ConfigurableLanguageRouteProfileOption {
  readonly id: ConfigurableLanguageRouteProfileId;
  readonly labelKey: SettingsMessageKey;
}

export const CONFIGURABLE_LANGUAGE_ROUTE_PROFILES: readonly ConfigurableLanguageRouteProfileOption[] = [
  { id: 'openai_compatible_chat', labelKey: 'settings.addModel.compatibility.openaiCompatible' },
  { id: 'openai_responses', labelKey: 'settings.addModel.compatibility.openaiResponses' },
  { id: 'anthropic_messages', labelKey: 'settings.addModel.compatibility.anthropicCompatible' },
  { id: 'google_generative_ai', labelKey: 'settings.protocol.googleGenerativeAi' },
];

export function isConfigurableLanguageRouteProfileId(
  profileId: LanguageInferenceRouteProfileId
): profileId is ConfigurableLanguageRouteProfileId {
  return CONFIGURABLE_LANGUAGE_ROUTE_PROFILE_IDS.some(candidate => candidate === profileId);
}

/** 模型详情只展示协议类别，不从 route 反猜 Provider 产品。 */
export function resolveConfigurableLanguageProtocolLabelKey(
  profileId: ConfigurableLanguageRouteProfileId
): SettingsMessageKey {
  if (profileId === 'openai_responses') {
    return 'settings.addModel.compatibility.openaiResponses';
  }
  if (profileId === 'anthropic_messages' || profileId === 'minimax_chat') {
    return 'settings.addModel.compatibility.anthropicCompatible';
  }
  if (profileId === 'google_generative_ai') return 'settings.protocol.googleGenerativeAi';
  return 'settings.addModel.compatibility.openaiCompatible';
}

export function readConfigurableLanguageRouteImageInputSupport(
  profileId: LanguageInferenceRouteProfileId
): LanguageInferenceImageInputSupport {
  return projectLanguageInferenceImageInputSupport(profileId, true);
}
