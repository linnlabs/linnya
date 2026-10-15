import {
  CustomApiModelRegistrationCommandSchema,
  ModelDiscoveryRequestSchema,
  extractDefaultProviderNameFromBaseUrl,
} from '@app/schemas';
import type {
  CustomApiRegistrationDraft,
  CustomApiRegistrationMessages,
} from '../definitions/customApiRegistrationSession';
import type { CustomApiModelRegistrationGateway } from '../definitions/customApiModelRegistrationGateway';
import { CustomApiModelRegistrationError } from '../definitions/customApiModelRegistrationError';
import {
  buildCustomApiRegistrationRequest,
  buildDiscoveredModelSelections,
  setCustomApiModelSelection,
  setAllCustomApiModelSelections,
} from '../functions/customApiRegistrationDraft';
import { createCustomApiRegistrationSessionStore } from '../store/customApiRegistrationSessionStore';
import { httpCustomApiModelRegistrationGateway } from '../infrastructure/httpCustomApiModelRegistrationGateway';

export function createCustomApiRegistrationSession(
  refreshModelCatalog: () => Promise<void>,
  messages: CustomApiRegistrationMessages,
  gateway: CustomApiModelRegistrationGateway = httpCustomApiModelRegistrationGateway
) {
  const store = createCustomApiRegistrationSessionStore();
  const { state } = store;
  let discovery: AbortController | undefined;
  let disposed = false;

  function invalidateDiscovery() {
    discovery?.abort();
    discovery = undefined;
    store.setModels([]);
    store.setDiscovering(false);
    store.setDiscoveryFeedback(null);
  }

  return {
    state,
    setField<K extends keyof CustomApiRegistrationDraft>(
      key: K,
      value: CustomApiRegistrationDraft[K]
    ) {
      if (disposed || state.status.isSubmitting) return;
      if (state.form[key] === value) return;
      if (key !== 'providerName') invalidateDiscovery();
      store.setField(key, value);
      if (key === 'baseUrl' && !state.userEditedProviderName) {
        store.setSuggestedProviderName(extractDefaultProviderNameFromBaseUrl(state.form.baseUrl));
      }
    },
    setModelEnabled(modelId: string, enabled: boolean) {
      if (state.status.isSubmitting || disposed) return;
      store.setModels(setCustomApiModelSelection(state.models, modelId, enabled));
    },
    setAllEnabled(enabled: boolean) {
      if (state.status.isSubmitting || disposed) return;
      store.setModels(setAllCustomApiModelSelections(state.models, enabled));
    },
    async discover() {
      if (state.status.isSubmitting || disposed) return;
      invalidateDiscovery();
      const request = ModelDiscoveryRequestSchema.safeParse({
        api_format: state.form.customApiFormat,
        base_url: state.form.baseUrl,
        ...(state.form.credentialSecret.trim()
          ? { api_key: state.form.credentialSecret.trim() }
          : {}),
      });
      if (!request.success) {
        store.setDiscoveryFeedback({
          kind: 'error',
          message: messages.invalidUrl,
        });
        return;
      }
      const current = new AbortController();
      discovery = current;
      store.setDiscovering(true);
      try {
        const result = await gateway.discoverModels(request.data, current.signal);
        if (disposed || discovery !== current) return;
        store.setModels(buildDiscoveredModelSelections(result.models));
        if (result.models.length === 0)
          store.setDiscoveryFeedback({ kind: 'info', message: messages.discoveryEmpty });
      } catch (error: unknown) {
        if (disposed || discovery !== current) return;
        store.setDiscoveryFeedback({
          kind: 'error',
          message:
            error instanceof CustomApiModelRegistrationError
              ? error.message
              : messages.discoveryFailed,
        });
      } finally {
        if (!disposed && discovery === current) {
          discovery = undefined;
          store.setDiscovering(false);
        }
      }
    },
    async submit() {
      if (disposed || state.status.isSubmitting || state.isDiscovering || state.models.length === 0)
        return;
      const command = CustomApiModelRegistrationCommandSchema.safeParse(
        buildCustomApiRegistrationRequest(state.form, state.models)
      );
      if (!command.success) {
        store.setStatus({
          isSubmitting: false,
          success: false,
          error: messages.invalidConfiguration,
        });
        return;
      }
      store.setStatus({ isSubmitting: true, success: false, error: null });
      try {
        await gateway.register(command.data);
      } catch (error: unknown) {
        if (!disposed)
          store.setStatus({
            isSubmitting: false,
            success: false,
            error:
              error instanceof CustomApiModelRegistrationError
                ? error.message
                : messages.registrationFailed,
          });
        return;
      }
      // 保存成功是提交边界；重读失败不能让用户误以为未保存而重复添加。
      if (!disposed) {
        store.reset();
        store.setStatus({ isSubmitting: true, success: true, error: null });
      }
      try {
        await refreshModelCatalog();
        if (!disposed) store.setStatus({ isSubmitting: false, success: true, error: null });
      } catch {
        if (!disposed)
          store.setStatus({
            isSubmitting: false,
            success: true,
            error: messages.synchronizationFailed,
          });
      }
    },
    dispose() {
      disposed = true;
      invalidateDiscovery();
      store.reset();
    },
  };
}
