import {
  CUSTOM_API_FORMAT_DEFINITIONS,
  type CustomApiFormat,
} from '@app/schemas/custom-api-onboarding';
import type { SettingsMessageKey } from '@/domains/settings/public';

export interface CustomApiFormatOption {
  readonly id: CustomApiFormat;
  readonly labelKey: SettingsMessageKey;
}

const CUSTOM_API_FORMAT_LABEL_KEYS = {
  openai_compatible: 'settings.addModel.compatibility.openaiCompatible',
  openai_responses: 'settings.addModel.compatibility.openaiResponses',
  anthropic_compatible: 'settings.addModel.compatibility.anthropicCompatible',
} as const satisfies Readonly<Record<CustomApiFormat, SettingsMessageKey>>;

/** Renderer 只拥有用户可见标签；membership 跟随共享 schema，runtime 映射仍只存在于 Host。 */
export const CUSTOM_API_FORMAT_OPTIONS: readonly CustomApiFormatOption[] =
  CUSTOM_API_FORMAT_DEFINITIONS.map(definition => ({
    id: definition.id,
    labelKey: CUSTOM_API_FORMAT_LABEL_KEYS[definition.id],
  }));
