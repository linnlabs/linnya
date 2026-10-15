<template>
  <Modal
    :is-visible="true"
    :title="settingsMessage('settings.modelPicker.editCustomProvider.title')"
    width="460px"
    scroll-mode="content"
    :close-on-overlay-click="!isSubmitting"
    :close-on-esc="!isSubmitting"
    @close="handleClose"
  >
    <div class="provider-connection-edit-content">
      <p class="provider-connection-edit-description">
        {{ settingsMessage('settings.modelPicker.editCustomProvider.description') }}
      </p>

      <div class="provider-connection-edit-field">
        <span class="provider-connection-edit-label">
          {{ settingsMessage('settings.addModel.customProvider.label') }}
        </span>
        <CustomTextInput
          v-model="form.providerName"
          class="settings-text-control"
          :placeholder="settingsMessage('settings.addModel.customProvider.placeholder')"
          :disabled="isSubmitting"
        />
      </div>

      <div class="provider-connection-edit-field">
        <span class="provider-connection-edit-label">
          {{ settingsMessage('settings.addModel.compatibility.label') }}
        </span>
        <CustomSelect
          v-model="form.customApiFormat"
          :options="customApiFormatOptions"
          :title="settingsMessage('settings.addModel.compatibility.selectTitle')"
          font-size="14px"
          :disabled="isSubmitting"
        />
      </div>

      <div class="provider-connection-edit-field">
        <span class="provider-connection-edit-label">
          {{ settingsMessage('settings.addModel.apiUrl.label') }}
        </span>
        <CustomTextInput
          v-model="form.baseUrl"
          class="settings-text-control"
          :placeholder="settingsMessage('settings.addModel.apiUrl.placeholder')"
          :disabled="isSubmitting"
        />
      </div>

      <div class="provider-connection-edit-field">
        <span class="provider-connection-edit-label">
          {{ settingsMessage('settings.addModel.apiKey.label') }}
        </span>
        <SecretInput
          v-model="form.credentialSecret"
          class="settings-text-control"
          :placeholder="
            settingsMessage('settings.modelPicker.editCustomProvider.apiKeyPlaceholder')
          "
          :disabled="isSubmitting"
        />
        <span class="provider-connection-edit-hint">
          {{ settingsMessage('settings.modelPicker.editCustomProvider.apiKeyHint') }}
        </span>
      </div>

      <SettingsFeedback kind="error" :message="error ?? ''" />
    </div>

    <template #footer>
      <div class="provider-connection-edit-footer">
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
import { computed, reactive, ref } from 'vue';
import type { CustomSelectOption } from '@linnya/renderer-ui';
import {
  ActionButtons,
  CustomSelect,
  CustomTextInput,
  Modal,
  SecretInput,
} from '@linnya/renderer-ui';
import { SettingsFeedback, useSettingsLocalization } from '@/domains/settings/public';
import { CUSTOM_API_FORMAT_OPTIONS } from '../definitions/customApiFormatOption';
import { CustomApiModelRegistrationError } from '../definitions/customApiModelRegistrationError';
import type {
  CustomApiProviderConnection,
  CustomApiProviderEditForm,
  CustomApiProviderEditIssue,
} from '../definitions/customApiProviderEdit';
import { updateCustomApiProvider } from '../orchestration/updateCustomApiProvider';
import './ProviderConnectionEditModal.css';

/** 父组件只在编辑期间挂载本弹窗；草稿与未提交的 Key 随卸载一起丢弃。 */
const props = defineProps<{
  readonly provider: CustomApiProviderConnection;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

const { settingsMessage } = useSettingsLocalization();
// 挂载时冻结一份 Host 投影作为草稿，后台刷新不会覆盖用户正在编辑的内容。
const form = reactive<CustomApiProviderEditForm>({
  providerName: props.provider.providerName,
  customApiFormat: props.provider.apiFormat ?? 'openai_compatible',
  baseUrl: props.provider.baseUrl ?? '',
  credentialSecret: '',
});
const isSubmitting = ref(false);
const error = ref<string | null>(null);

const customApiFormatOptions = computed<CustomSelectOption[]>(() =>
  CUSTOM_API_FORMAT_OPTIONS.map(option => ({
    value: option.id,
    text: settingsMessage(option.labelKey),
  }))
);

const primaryActionText = computed(() =>
  isSubmitting.value
    ? settingsMessage('settings.modelPicker.dialog.saving')
    : settingsMessage('settings.modelPicker.dialog.save')
);

function resolveIssue(issue: CustomApiProviderEditIssue): string {
  return issue === 'provider_name_required'
    ? settingsMessage('settings.modelPicker.editCustomProvider.providerNameRequired')
    : settingsMessage('settings.addModel.error.apiUrlInvalid');
}

function handleClose(): void {
  if (isSubmitting.value) return;
  emit('close');
}

async function submit(): Promise<void> {
  if (isSubmitting.value) return;
  isSubmitting.value = true;
  error.value = null;
  try {
    const result = await updateCustomApiProvider(props.provider.providerName, form);
    if (!result.ok) {
      error.value = resolveIssue(result.issue);
      return;
    }
    form.credentialSecret = '';
    emit('saved');
  } catch (failure: unknown) {
    console.error('[CustomApiProviderEdit] 保存自定义模型供应商失败', {
      errorCode:
        failure instanceof CustomApiModelRegistrationError ? failure.code : 'unknown_error',
    });
    error.value =
      failure instanceof CustomApiModelRegistrationError
        ? failure.message
        : settingsMessage('settings.modelPicker.editCustomProvider.failed');
  } finally {
    isSubmitting.value = false;
  }
}
</script>
