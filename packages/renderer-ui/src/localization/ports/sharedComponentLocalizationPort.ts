import type { InjectionKey } from 'vue';
import type { SharedComponentRawMessageResolver } from '../functions/resolveSharedComponentMessage';

export interface SharedComponentLocalizationPort {
  readonly message: SharedComponentRawMessageResolver;
}

export const SHARED_COMPONENT_LOCALIZATION_PORT_KEY: InjectionKey<SharedComponentLocalizationPort> = Symbol(
  'SHARED_COMPONENT_LOCALIZATION_PORT_KEY',
);

export const FALLBACK_SHARED_COMPONENT_LOCALIZATION_PORT: SharedComponentLocalizationPort = {
  message: (_key, fallback) => fallback,
};
