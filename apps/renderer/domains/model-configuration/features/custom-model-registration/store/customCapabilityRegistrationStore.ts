import { reactive, readonly } from 'vue';
import type { CustomCapabilityApiFormat } from '@app/schemas/custom-api-onboarding';
import type {
  CustomCapabilityDraft,
  CustomCapabilityRegistrationState,
} from '../definitions/customCapabilityRegistration';

export function createCustomCapabilityRegistrationStore(apiFormat: CustomCapabilityApiFormat) {
  const state = reactive<CustomCapabilityRegistrationState>({
    form: {
      providerName: '',
      baseUrl: '',
      credentialSecret: '',
      apiFormat,
      modelId: '',
      displayName: '',
      ocrMode: 'document_upload',
      imageSizes: '',
    },
    busy: null,
    error: '',
    feedback: '',
    saved: false,
  });
  return {
    state: readonly(state),
    setField<K extends keyof CustomCapabilityDraft>(key: K, value: CustomCapabilityDraft[K]) {
      state.form[key] = value;
      state.error = '';
      state.feedback = '';
      state.saved = false;
    },
    setBusy(busy: CustomCapabilityRegistrationState['busy']) {
      state.busy = busy;
    },
    setError(message: string) {
      state.error = message;
      state.feedback = '';
    },
    setFeedback(message: string) {
      state.feedback = message;
      state.error = '';
    },
    saved() {
      state.saved = true;
      state.form.credentialSecret = '';
    },
    clearSecret() {
      state.form.credentialSecret = '';
    },
  };
}
