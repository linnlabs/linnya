export {
  DEFAULT_LINNYA_LOCALE,
  FALLBACK_LINNYA_LOCALE,
  SUPPORTED_LINNYA_LOCALES,
  isLinnyaLocale,
  type LinnyaLocale,
} from './definitions/locale';
export type {
  LocalizedText,
  MessageParams,
  MessageParamValue,
} from '@linnya/plugin-host-contract/renderer/localization';
export type {
  MessageCatalog,
  MessageCatalogContribution,
  MessageCatalogsByLocale,
} from '@linnya/plugin-host-contract/renderer/localization';
export { interpolateMessage } from './functions/interpolateMessage';
export {
  normalizeLinnyaLocale,
  normalizeLinnyaLocaleOrDefault,
} from './functions/normalizeLocale';
export { resolveLocalizedText } from './functions/resolveLocalizedText';
export {
  clearLocalizationRegistryForTest,
  registerMessageCatalogs,
  resolveRegisteredMessage,
  unregisterMessageCatalogOwner,
  useLocalizationRegistryRevision,
} from './registry/localizationRegistry';
export { useLocalizationStore } from './store/localizationStore';
export { changeLocale } from './orchestration/changeLocale';
export { initializeLocalization } from './orchestration/initializeLocalization';
export { useLocalization } from './vue/useLocalization';
