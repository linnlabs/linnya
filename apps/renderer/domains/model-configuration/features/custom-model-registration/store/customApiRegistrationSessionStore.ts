import { reactive, readonly } from 'vue';
import type {
  CustomApiRegistrationDraft,
  CustomApiRegistrationSelection,
  CustomApiRegistrationSessionState,
} from '../definitions/customApiRegistrationSession';
import { createCustomApiRegistrationDraft } from '../functions/customApiRegistrationDraft';

/** 表单实例持有短期明文；不能进入全局 Pinia、持久化或跨页面共享。 */
export function createCustomApiRegistrationSessionStore() {
  const state = reactive<CustomApiRegistrationSessionState>({
    form: createCustomApiRegistrationDraft(),
    models: [],
    userEditedProviderName: false,
    isDiscovering: false,
    discoveryFeedback: null,
    status: { isSubmitting: false, success: false, error: null },
  });
  return {
    state: readonly(state),
    setField<K extends keyof CustomApiRegistrationDraft>(
      key: K,
      value: CustomApiRegistrationDraft[K]
    ) {
      state.form[key] = value;
      state.status.success = false;
      state.status.error = null;
      if (key === 'providerName') state.userEditedProviderName = true;
    },
    setSuggestedProviderName(value: string) {
      state.form.providerName = value;
    },
    setModels(models: readonly CustomApiRegistrationSelection[]) {
      state.models = [...models];
    },
    setDiscovering(value: boolean) {
      state.isDiscovering = value;
    },
    setDiscoveryFeedback(value: CustomApiRegistrationSessionState['discoveryFeedback']) {
      state.discoveryFeedback = value;
    },
    setStatus(value: CustomApiRegistrationSessionState['status']) {
      state.status = { ...value };
    },
    reset() {
      state.form = createCustomApiRegistrationDraft();
      state.models = [];
      state.userEditedProviderName = false;
      state.discoveryFeedback = null;
      state.isDiscovering = false;
    },
  };
}
