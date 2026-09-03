import { watch, type WatchStopHandle } from 'vue';
import { normalizeLinnyaLocaleOrDefault } from '../functions/normalizeLocale';
import { useLocalizationStore } from '../store/localizationStore';
import { syncDocumentLocale } from './syncDocumentLocale';

let stopDocumentLocaleSync: WatchStopHandle | null = null;

export interface InitializeLocalizationOptions {
  readonly document: Document;
}

export function initializeLocalization(options: InitializeLocalizationOptions): void {
  const store = useLocalizationStore();
  const normalizedLocale = normalizeLinnyaLocaleOrDefault(store.currentLocale);
  if (normalizedLocale !== store.currentLocale) {
    store.setCurrentLocale(normalizedLocale);
  }

  stopDocumentLocaleSync?.();
  stopDocumentLocaleSync = watch(
    () => store.currentLocale,
    (locale) => {
      syncDocumentLocale(options.document, locale);
    },
    { immediate: true },
  );
}
