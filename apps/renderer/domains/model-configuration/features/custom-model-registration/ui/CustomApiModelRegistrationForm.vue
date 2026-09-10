<template>
  <div class="add-model-provider-form" data-registration-kind="custom-provider">
    <SettingsRow
      :label="settingsMessage('settings.addModel.modelName.label')"
      :hint="settingsMessage('settings.addModel.api.modelName.description')"
    >
      <CustomSelect
        v-if="discoveredModelOptions.length > 0"
        v-model="form.endpointModelId"
        :options="discoveredModelOptions"
        :placeholder="settingsMessage('settings.addModel.api.modelName.placeholder')"
        class="settings-text-control"
        bordered
        font-size="14px"
        @update:model-value="onModelSelect"
      />
      <CustomTextInput
        v-else
        v-model="form.endpointModelId"
        class="settings-text-control"
        :placeholder="settingsMessage('settings.addModel.api.modelName.placeholder')"
      />
    </SettingsRow>

    <SettingsRow
      :label="settingsMessage('settings.addModel.displayName.label')"
      :hint="settingsMessage('settings.addModel.displayName.description')"
    >
      <CustomTextInput
        v-model="form.displayName"
        class="settings-text-control"
        :placeholder="settingsMessage('settings.addModel.displayName.placeholder')"
      />
    </SettingsRow>

    <SettingsRow
      :label="settingsMessage('settings.addModel.apiKey.label')"
      :hint="settingsMessage('settings.addModel.apiKey.optionalReuseDescription')"
    >
      <SecretInput
        v-model="form.credentialSecret"
        class="settings-text-control"
        :placeholder="settingsMessage('settings.addModel.apiKey.placeholder')"
      />
    </SettingsRow>

    <SettingsRow :label="settingsMessage('settings.addModel.apiUrl.label')">
      <CustomTextInput
        v-model="form.baseUrl"
        class="settings-text-control"
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
      <div class="settings-field-with-action add-model-select-with-action">
        <CustomSelect
          v-model="form.customApiFormat"
          :options="customApiFormatOptions"
          :title="settingsMessage('settings.addModel.compatibility.selectTitle')"
          class="add-model-select-control flex-grow"
          font-size="14px"
        />
        <button
          type="button"
          class="settings-button settings-button-secondary add-model-discover-button"
          :disabled="isDiscovering || !form.baseUrl"
          :title="settingsMessage('settings.addModel.discover.button')"
          @click="discoverModels"
        >
          <RefreshIcon class="add-model-refresh-icon" :class="{ 'is-spinning': isDiscovering }" />
          <span>{{ isDiscovering ? settingsMessage('settings.addModel.discover.fetching') : settingsMessage('settings.addModel.discover.button') }}</span>
        </button>
      </div>
      <SettingsFeedback
        v-if="discoveryFeedback"
        :kind="discoveryFeedback.kind"
        :message="discoveryFeedback.message"
      />
    </SettingsRow>

    <SettingsRow
      :label="settingsMessage('settings.modelCapacity.contextWindow.label')"
      :hint="settingsMessage('settings.modelCapacity.contextWindow.description')"
    >
      <CustomTextInput
        v-model="form.contextWindowTokens"
        class="settings-text-control"
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
        class="settings-text-control"
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
import { httpCustomApiModelRegistrationGateway } from '../infrastructure/httpCustomApiModelRegistrationGateway';
import type { DiscoveredModel } from '@app/schemas';
import { RefreshIcon } from '@linnya/renderer-ui/icons';

const props = defineProps<{ readonly refreshModelCatalog: () => Promise<void> }>();
const { settingsMessage } = useSettingsLocalization();
const status = reactive<RegistrationFormStatus>({
  isSubmitting: false,
  success: false,
  error: null,
});
const form = ref<ApiCustomModelForm>(createInitialForm());
let successTimer: number | null = null;

const isDiscovering = ref(false);
const discoveredModels = ref<DiscoveredModel[]>([]);
const discoveryFeedback = ref<{ kind: 'info' | 'error' | 'success'; message: string } | null>(null);

const discoveredModelOptions = computed<CustomSelectOption[]>(() =>
  discoveredModels.value.map(model => ({
    value: model.id,
    text: model.name !== model.id ? `${model.name} (${model.id})` : model.id,
  }))
);

async function discoverModels(): Promise<void> {
  if (!form.value.baseUrl) return;
  isDiscovering.value = true;
  discoveryFeedback.value = null;

  try {
    const result = await httpCustomApiModelRegistrationGateway.discoverModels?.({
      api_format: form.value.customApiFormat,
      base_url: form.value.baseUrl,
      api_key: form.value.credentialSecret || undefined,
    });

    if (!result || result.models.length === 0) {
      discoveryFeedback.value = {
        kind: 'info',
        message: settingsMessage('settings.addModel.discover.empty'),
      };
      discoveredModels.value = [];
      return;
    }

    discoveredModels.value = [...result.models];
    discoveryFeedback.value = {
      kind: 'success',
      message: settingsMessage('settings.addModel.discover.success').replace(
        '{count}',
        String(result.models.length)
      ),
    };

    // 默认选中第一个
    if (result.models[0]) {
      applyDiscoveredModel(result.models[0]);
    }
  } catch (error: unknown) {
    discoveredModels.value = [];
    discoveryFeedback.value = {
      kind: 'error',
      message:
        error instanceof Error ? error.message : settingsMessage('settings.addModel.error.unknown'),
    };
  } finally {
    isDiscovering.value = false;
  }
}

function applyDiscoveredModel(model: DiscoveredModel): void {
  form.value.endpointModelId = model.id;
  if (!form.value.displayName || form.value.displayName === form.value.endpointModelId) {
    form.value.displayName = model.name;
  }
  if (model.context_window_tokens) {
    form.value.contextWindowTokens = String(model.context_window_tokens);
  }
  if (model.max_output_tokens) {
    form.value.maxOutputTokens = String(model.max_output_tokens);
  }
  if (model.supports_image_input !== undefined) {
    form.value.supportsImageInput = model.supports_image_input;
  }
}

function onModelSelect(modelId: string): void {
  const target = discoveredModels.value.find(m => m.id === modelId);
  if (target) {
    applyDiscoveredModel(target);
  }
}

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
    discoveredModels.value = [];
    discoveryFeedback.value = null;
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
