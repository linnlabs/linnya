import { computed, type ComputedRef } from 'vue';
import type { LinnyaLocale } from '../definitions/locale';
import type { LocalizedText, MessageParams } from '../definitions/localizedText';
import { resolveLocalizedText } from '../functions/resolveLocalizedText';
import { changeLocale as changeLocaleOrchestration } from '../orchestration/changeLocale';
import {
  resolveRegisteredMessage,
  useLocalizationRegistryRevision,
} from '../registry/localizationRegistry';
import { useLocalizationStore } from '../store/localizationStore';

export interface UseLocalizationResult {
  readonly currentLocale: ComputedRef<LinnyaLocale>;
  readonly fallbackLocale: ComputedRef<LinnyaLocale>;
  readonly t: (text: LocalizedText) => string;
  readonly message: (key: string, fallback: string, params?: MessageParams) => string;
  readonly changeLocale: (locale: LinnyaLocale) => void;
}

export function useLocalization(): UseLocalizationResult {
  const store = useLocalizationStore();
  const registryRevision = useLocalizationRegistryRevision();

  const currentLocale = computed(() => store.currentLocale);
  const fallbackLocale = computed(() => store.fallbackLocale);

  function t(text: LocalizedText): string {
    void registryRevision.value;
    return resolveLocalizedText(text, {
      locale: store.currentLocale,
      fallbackLocale: store.fallbackLocale,
      resolveMessage: resolveRegisteredMessage,
    });
  }

  function message(key: string, fallback: string, params?: MessageParams): string {
    return t(params === undefined ? { key, fallback } : { key, fallback, params });
  }

  return {
    currentLocale,
    fallbackLocale,
    t,
    message,
    changeLocale: changeLocaleOrchestration,
  };
}
