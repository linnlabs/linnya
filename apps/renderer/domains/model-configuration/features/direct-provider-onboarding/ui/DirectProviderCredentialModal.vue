<template>
  <Modal
    :is-visible="true"
    :title="settingsMessage('settings.modelPicker.replaceApiKey.title', { providerName })"
    width="460px"
    scroll-mode="content"
    :close-on-overlay-click="!isSubmitting"
    :close-on-esc="!isSubmitting"
    @close="handleClose"
  >
    <div class="direct-provider-credential-content">
      <p class="direct-provider-credential-description">
        {{ settingsMessage('settings.modelPicker.replaceApiKey.description') }}
      </p>
      <div class="direct-provider-credential-field">
        <span class="direct-provider-credential-label">
          {{ settingsMessage('settings.addModel.apiKey.label') }}
        </span>
        <SecretInput
          v-model="apiKey"
          class="settings-text-control"
          :placeholder="settingsMessage('settings.addModel.apiKey.placeholder')"
          :disabled="isSubmitting"
        />
      </div>
      <SettingsFeedback kind="error" :message="error ?? ''" />
    </div>

    <template #footer>
      <div class="direct-provider-credential-footer">
        <ActionButtons
          :secondary-action-text="settingsMessage('settings.modelPicker.dialog.cancel')"
          :primary-action-text="primaryActionText"
          :is-primary-action-disabled="isSubmitting"
          :is-secondary-action-disabled="isSubmitting"
          @secondary-click="handleClose"
          @primary-click="submit"
        />
      </div>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ActionButtons, Modal, SecretInput } from '@linnya/renderer-ui';
import { SettingsFeedback, useSettingsLocalization } from '@/domains/settings/public';
import { DirectProviderOnboardingError } from '../definitions/directProviderOnboardingError';
import { replaceDirectProviderCredential } from '../orchestration/replaceDirectProviderCredential';
import './DirectProviderCredentialModal.css';

/** 父组件只在更换期间挂载本弹窗；未提交的 Key 随卸载一起丢弃。 */
const props = defineProps<{
  readonly providerConnectionDefinitionId: string;
  readonly providerName: string;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

const { settingsMessage } = useSettingsLocalization();
const apiKey = ref('');
const isSubmitting = ref(false);
const error = ref<string | null>(null);

const primaryActionText = computed(() =>
  isSubmitting.value
    ? settingsMessage('settings.modelPicker.dialog.saving')
    : settingsMessage('settings.modelPicker.dialog.save')
);

function handleClose(): void {
  if (isSubmitting.value) return;
  emit('close');
}

async function submit(): Promise<void> {
  if (isSubmitting.value) return;
  isSubmitting.value = true;
  error.value = null;
  try {
    const result = await replaceDirectProviderCredential(
      props.providerConnectionDefinitionId,
      apiKey.value
    );
    if (!result.ok) {
      error.value = settingsMessage('settings.addModel.error.apiKeyRequired');
      return;
    }
    apiKey.value = '';
    emit('saved');
  } catch (failure: unknown) {
    console.error('[DirectProviderCredential] 更新 Provider API Key 失败', {
      errorCode: failure instanceof DirectProviderOnboardingError ? failure.code : 'unknown_error',
    });
    error.value =
      failure instanceof DirectProviderOnboardingError
        ? failure.message
        : settingsMessage('settings.modelPicker.replaceApiKey.failed');
  } finally {
    isSubmitting.value = false;
  }
}
</script>
