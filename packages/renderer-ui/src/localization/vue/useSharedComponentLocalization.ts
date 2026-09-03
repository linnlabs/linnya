import { inject } from 'vue';
import type { SharedComponentMessageResolver } from '../definitions/sharedComponentMessages';
import { createSharedComponentMessageResolver } from '../functions/resolveSharedComponentMessage';
import {
  FALLBACK_SHARED_COMPONENT_LOCALIZATION_PORT,
  SHARED_COMPONENT_LOCALIZATION_PORT_KEY,
} from '../ports/sharedComponentLocalizationPort';

export interface UseSharedComponentLocalizationResult {
  readonly sharedComponentMessage: SharedComponentMessageResolver;
}

export function useSharedComponentLocalization(): UseSharedComponentLocalizationResult {
  const port = inject(
    SHARED_COMPONENT_LOCALIZATION_PORT_KEY,
    FALLBACK_SHARED_COMPONENT_LOCALIZATION_PORT,
  );

  return {
    sharedComponentMessage: createSharedComponentMessageResolver(port.message),
  };
}
