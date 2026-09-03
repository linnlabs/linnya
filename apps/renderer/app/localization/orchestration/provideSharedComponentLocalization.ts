import {
  SHARED_COMPONENT_MESSAGE_CATALOGS,
  SHARED_COMPONENT_LOCALIZATION_PORT_KEY,
  type SharedComponentMessageParams,
  type SharedComponentLocalizationPort,
} from '@linnya/renderer-ui/localization';
import type { App } from 'vue';
import type { MessageParams } from '../definitions/localizedText';
import { resolveLocalizedText } from '../functions/resolveLocalizedText';
import { resolveRegisteredMessage, useLocalizationRegistryRevision } from '../registry/localizationRegistry';
import { registerMessageCatalogs } from '../registry/localizationRegistry';
import { useLocalizationStore } from '../store/localizationStore';

let registered = false;

function toMessageParams(params: SharedComponentMessageParams): MessageParams {
  const messageParams: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    messageParams[key] = value;
  }
  return messageParams;
}

function createSharedComponentLocalizationPort(): SharedComponentLocalizationPort {
  return {
    message(key, fallback, params) {
      const store = useLocalizationStore();
      const registryRevision = useLocalizationRegistryRevision();
      void registryRevision.value;

      const messageParams = params === undefined ? undefined : toMessageParams(params);
      const text = messageParams === undefined
        ? { key, fallback }
        : { key, fallback, params: messageParams };

      return resolveLocalizedText(text, {
        locale: store.currentLocale,
        fallbackLocale: store.fallbackLocale,
        resolveMessage: resolveRegisteredMessage,
      });
    },
  };
}

export function ensureSharedComponentLocalizationRegistered(): void {
  if (registered) return;

  registerMessageCatalogs({
    owner: 'shared.components',
    catalogs: SHARED_COMPONENT_MESSAGE_CATALOGS,
  });
  registered = true;
}

export function provideSharedComponentLocalization(app: App): void {
  app.provide(
    SHARED_COMPONENT_LOCALIZATION_PORT_KEY,
    createSharedComponentLocalizationPort(),
  );
}
