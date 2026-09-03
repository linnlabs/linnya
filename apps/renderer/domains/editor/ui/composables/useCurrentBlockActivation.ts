import { computed, inject, ref, type InjectionKey } from 'vue';
import type { UseBlockActivationReturn } from './useBlockActivation';

export const CURRENT_BLOCK_ACTIVATION_KEY: InjectionKey<UseBlockActivationReturn> = Symbol(
  'CURRENT_BLOCK_ACTIVATION_KEY'
);

export function createDefaultBlockActivation(): UseBlockActivationReturn {
  const activeRef = ref(true);
  const activeComputed = computed(() => true);
  const emptyReasons = computed<string[]>(() => []);

  return {
    isUiActive: activeRef,
    activationMask: computed(() => 0),
    activationReasons: emptyReasons,
    renderHandles: activeComputed,
    renderAnnotation: activeComputed,
    renderRevisionChrome: activeComputed,
    renderRevisionToolbar: activeComputed,
    renderHistory: activeComputed,
  };
}

export function useCurrentBlockActivation(): UseBlockActivationReturn {
  return inject(CURRENT_BLOCK_ACTIVATION_KEY, createDefaultBlockActivation());
}
