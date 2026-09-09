<template>
  <div
    class="add-model-provider-form"
    data-registration-kind="direct-provider"
  >
    <SettingsRow
      :label="settingsMessage('settings.addModel.apiKey.label')"
      :hint="settingsMessage('settings.addModel.apiKey.providerDescription')"
    >
      <SecretInput
        v-model="form.apiKey"
        class="settings-text-control"
        :placeholder="settingsMessage('settings.addModel.apiKey.placeholder')"
      />
      <button
        v-if="selectedConnection?.setup_help_url"
        type="button"
        class="settings-external-link"
        @click="openSetupHelp"
      >
        <LinkIcon class="settings-external-link-icon" />
        <span>{{ settingsMessage('settings.addModel.apiKey.obtain') }}</span>
      </button>
    </SettingsRow>

    <div class="add-model-submit">
      <button
        type="button"
        class="settings-button full-width-button"
        :disabled="status.isSubmitting || status.success"
        @click="submit"
      >
        {{ submitText }}
      </button>
      <SettingsFeedback
        kind="error"
        :message="status.error || ''"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import { LinkIcon } from '@linnya/renderer-ui/icons';
import { SecretInput } from '@linnya/renderer-ui';
import { openExternalUrl } from '@/shared/utils/openExternalUrl';
import { SettingsFeedback, SettingsRow, useSettingsLocalization } from '@/domains/settings/public';
import { useProviderCatalogReadModel } from '../../provider-catalog';
import type { RegistrationFormStatus } from '../../custom-model-registration';
import type { DirectProviderOnboardingForm } from '../definitions/directProviderOnboardingForm';
import { DirectProviderOnboardingError } from '../definitions/directProviderOnboardingError';
import { connectDirectProvider } from '../orchestration/connectDirectProvider';

const providerCatalog = useProviderCatalogReadModel();
const { settingsMessage } = useSettingsLocalization();
const props = defineProps<{
  readonly providerConnectionDefinitionId: string;
  readonly refreshModelCatalog: () => Promise<void>;
}>();
const status = reactive<RegistrationFormStatus>({
  isSubmitting: false,
  success: false,
  error: null,
});
const form = ref<DirectProviderOnboardingForm>(
  createInitialForm(props.providerConnectionDefinitionId)
);
let successTimer: number | null = null;

const selectedConnection = computed(() =>
  providerCatalog.providers.value
    .flatMap(provider => provider.connections)
    .find(connection => connection.id === form.value.providerConnectionDefinitionId)
);

function openSetupHelp(): void {
  const setupHelpUrl = selectedConnection.value?.setup_help_url;
  if (setupHelpUrl) openExternalUrl(setupHelpUrl);
}

const submitText = computed(() => {
  if (status.isSubmitting) return settingsMessage('settings.addModel.submit.adding');
  if (status.success) return settingsMessage('settings.addModel.submit.success');
  return settingsMessage('settings.addModel.submit.add');
});

function createInitialForm(providerConnectionDefinitionId: string): DirectProviderOnboardingForm {
  return { providerConnectionDefinitionId, apiKey: '' };
}

function resolveRegistrationIssue(issue: 'provider_required' | 'api_key_required'): string {
  if (issue === 'provider_required') {
    return settingsMessage('settings.addModel.error.providerRequired');
  }
  return settingsMessage('settings.addModel.error.apiKeyRequired');
}

function showSuccess(): void {
  status.success = true;
  status.error = null;
  if (successTimer !== null) window.clearTimeout(successTimer);
  successTimer = window.setTimeout(() => {
    status.success = false;
  }, 3000);
}

async function submit(): Promise<void> {
  status.isSubmitting = true;
  status.success = false;
  status.error = null;
  try {
    const result = await connectDirectProvider(form.value);
    if (!result.ok) {
      status.error = resolveRegistrationIssue(result.issue);
      return;
    }
    form.value = createInitialForm(props.providerConnectionDefinitionId);
    await props.refreshModelCatalog();
    showSuccess();
  } catch (error: unknown) {
    console.error('[DirectProviderOnboarding] Provider 连接失败', {
      errorCode: error instanceof DirectProviderOnboardingError ? error.code : 'unknown_error',
    });
    status.error =
      error instanceof DirectProviderOnboardingError
        ? error.message
        : settingsMessage('settings.addModel.error.unknown');
  } finally {
    status.isSubmitting = false;
  }
}

onBeforeUnmount(() => {
  if (successTimer !== null) window.clearTimeout(successTimer);
});
</script>
