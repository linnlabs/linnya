export type {
  SharedColorMessageKey,
  SharedComponentMessageKey,
  SharedComponentMessageParams,
  SharedComponentMessageParamValue,
  SharedComponentMessageResolver,
} from './definitions/sharedComponentMessages';
export {
  SHARED_COMPONENT_MESSAGE_CATALOGS,
  SHARED_COMPONENT_MESSAGE_FALLBACKS,
} from './definitions/sharedComponentMessageCatalog';
export type { SharedComponentRawMessageResolver } from './functions/resolveSharedComponentMessage';
export {
  createSharedComponentMessageResolver,
  resolveSharedComponentMessage,
} from './functions/resolveSharedComponentMessage';
export type { SharedComponentLocalizationPort } from './ports/sharedComponentLocalizationPort';
export {
  FALLBACK_SHARED_COMPONENT_LOCALIZATION_PORT,
  SHARED_COMPONENT_LOCALIZATION_PORT_KEY,
} from './ports/sharedComponentLocalizationPort';
export type { UseSharedComponentLocalizationResult } from './vue/useSharedComponentLocalization';
export { useSharedComponentLocalization } from './vue/useSharedComponentLocalization';
