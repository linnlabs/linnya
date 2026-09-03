<template>
  <div class="add-model-provider-form" data-registration-kind="custom-provider">
    <SettingsRow
      :label="settingsMessage('settings.addModel.modelName.label')"
      :hint="settingsMessage('settings.addModel.api.modelName.description')"
    >
      <CustomTextInput
        v-model="form.endpointModelId"
        :placeholder="settingsMessage('settings.addModel.api.modelName.placeholder')"
      />
    </SettingsRow>

    <SettingsRow
      :label="settingsMessage('settings.addModel.displayName.label')"
      :hint="settingsMessage('settings.addModel.displayName.description')"
    >
      <CustomTextInput
        v-model="form.displayName"
        :placeholder="settingsMessage('settings.addModel.displayName.placeholder')"
      />
    </SettingsRow>

    <SettingsRow
      :label="settingsMessage('settings.addModel.apiKey.label')"
      :hint="settingsMessage('settings.addModel.apiKey.optionalReuseDescription')"
    >
      <SecretInput
        v-model="form.credentialSecret"
        :placeholder="settingsMessage('settings.addModel.apiKey.placeholder')"
      />
    </SettingsRow>

    <SettingsRow :label="settingsMessage('settings.addModel.apiUrl.label')">
      <CustomTextInput
        v-model="form.baseUrl"
        :placeholder="settingsMessage('settings.addModel.apiUrl.placeholder')"
      />
      <template #hint>
        {{ settingsMessage('settings.addModel.apiUrl.descriptionLine1') }}<br />
        {{ settingsMessage('settings.addModel.apiUrl.descriptionLine2') }}
      </template>
    </SettingsRow>

    <SettingsRow
      :label="settingsMessage('settings.addModel.compatibility.label')"
      :hint="settingsMessage('settings.addModel.compatibility.description')"
    >
      <CustomSelect
        v-model="form.customApiFormat"
        :options="customApiFormatOptions"
        :title="settingsMessage('settings.addModel.compatibility.selectTitle')"
        font-size="14px"
      />
    </SettingsRow>

    <SettingsRow
      :label="settingsMessage('settings.modelCapacity.contextWindow.label')"
      :hint="settingsMessage('settings.modelCapacity.contextWindow.description')"
    >
      <CustomTextInput
        v-model="form.contextWindowTokens"
        inputmode="numeric"
        pattern="[0-9]*"
        :placeholder="settingsMessage('settings.modelCapacity.contextWindow.placeholder')"
      />
    </SettingsRow>

    <SettingsRow
      :label="settingsMessage('settings.modelCapacity.maxOutput.label')"
      :hint="settingsMessage('settings.modelCapacity.maxOutput.description')"
    >
      <CustomTextInput
        v-model="form.maxOutputTokens"
        inputmode="numeric"
        pattern="[0-9]*"
        :placeholder="settingsMessage('settings.modelCapacity.maxOutput.placeholder')"
      />
    </SettingsRow>

    <SettingsSwitchRow
      v-model="form.supportsImageInput"
      :label="settingsMessage('settings.modelCapability.imageInput')"
      :description="settingsMessage('settings.addModel.imageInput.description')"
    />

    <div class="add-model-submit">
      <button
        type="button"
        class="settings-button full-width-button"
        :disabled="status.isSubmitting || status.success"
        @click="submit"
      >
        {{ submitText }}
      </button>
      <SettingsFeedback kind="error" :message="status.error || ''" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import type { CustomSelectOption } from '@linnya/renderer-ui';
import { CustomSelect, CustomTextInput, SecretInput } from '@linnya/renderer-ui';
import {
  SettingsFeedback,
  SettingsRow,
  SettingsSwitchRow,
  useSettingsLocalization,
} from '@/domains/settings/public';
import type {
  ApiCustomModelForm,
  RegistrationFormStatus,
} from '../definitions/customModelRegistrationForm';
import { CUSTOM_API_FORMAT_OPTIONS } from '../definitions/customApiFormatOption';
import { CustomApiModelRegistrationError } from '../definitions/customApiModelRegistrationError';
import type { CustomModelRegistrationIssue } from '../definitions/customModelRegistrationResult';
import { registerApiCustomModel } from '../orchestration/registerApiCustomModel';

const props = defineProps<{ readonly refreshModelCatalog: () => Promise<void> }>();
const { settingsMessage } = useSettingsLocalization();
const status = reactive<RegistrationFormStatus>({
  isSubmitting: false,
  success: false,
  error: null,
});
const form = ref<ApiCustomModelForm>(createInitialForm());
let successTimer: number | null = null;

const customApiFormatOptions = computed<CustomSelectOption[]>(() =>
  CUSTOM_API_FORMAT_OPTIONS.map(option => ({
    value: option.id,
    text: settingsMessage(option.labelKey),
  }))
);

const submitText = computed(() => {
  if (status.isSubmitting) return settingsMessage('settings.addModel.submit.adding');
  if (status.success) return settingsMessage('settings.addModel.submit.success');
  return settingsMessage('settings.addModel.submit.add');
});

function createInitialForm(): ApiCustomModelForm {
  return {
    endpointModelId: '',
    displayName: '',
    credentialSecret: '',
    baseUrl: '',
    customApiFormat: 'openai_compatible',
    contextWindowTokens: '256000',
    maxOutputTokens: '16384',
    supportsImageInput: false,
  };
}

function resolveRegistrationIssue(issue: CustomModelRegistrationIssue): string {
  if (issue === 'endpoint_model_id_required') {
    return settingsMessage('settings.addModel.error.modelNameRequired');
  }
  if (issue === 'base_url_invalid') {
    return settingsMessage('settings.addModel.error.apiUrlInvalid');
  }
  return settingsMessage('settings.modelCapacity.validation.positiveIntegers');
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
    const result = await registerApiCustomModel(form.value);
    if (!result.ok) {
      status.error = resolveRegistrationIssue(result.issue);
      return;
    }
    form.value = createInitialForm();
    await props.refreshModelCatalog();
    showSuccess();
  } catch (error: unknown) {
    console.error('[CustomApiModelRegistration] 模型注册失败', {
      errorCode: error instanceof CustomApiModelRegistrationError ? error.code : 'unknown_error',
    });
    status.error =
      error instanceof CustomApiModelRegistrationError
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
