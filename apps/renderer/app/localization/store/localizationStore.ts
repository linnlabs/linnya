import { defineStore } from 'pinia';
import { getRendererPersistStorage } from '@/shared/persistence/rendererPersistStorage';
import {
  DEFAULT_LINNYA_LOCALE,
  FALLBACK_LINNYA_LOCALE,
  type LinnyaLocale,
} from '../definitions/locale';

interface LocalizationState {
  currentLocale: LinnyaLocale;
  fallbackLocale: LinnyaLocale;
}

export const useLocalizationStore = defineStore('localization', {
  state: (): LocalizationState => ({
    currentLocale: DEFAULT_LINNYA_LOCALE,
    fallbackLocale: FALLBACK_LINNYA_LOCALE,
  }),

  actions: {
    setCurrentLocale(locale: LinnyaLocale): void {
      this.currentLocale = locale;
    },
  },

  persist: {
    key: 'localization-settings',
    storage: getRendererPersistStorage(),
    pick: ['currentLocale'],
  },
});
