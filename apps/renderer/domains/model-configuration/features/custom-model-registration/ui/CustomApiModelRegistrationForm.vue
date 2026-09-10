<template>
  <div class="add-model-provider-form" data-registration-kind="custom-provider">
    <SettingsRow
      :label="settingsMessage('settings.addModel.customProvider.label')"
      :hint="settingsMessage('settings.addModel.customProvider.description')"
    >
      <CustomTextInput
        v-model="form.providerName"
        class="settings-text-control"
        :placeholder="settingsMessage('settings.addModel.customProvider.placeholder')"
        @input="userEditedProviderName = true"
      />
    </SettingsRow>

    <SettingsRow :label="settingsMessage('settings.addModel.apiUrl.label')">
      <CustomTextInput
        v-model="form.baseUrl"
        class="settings-text-control"
        :placeholder="settingsMessage('settings.addModel.apiUrl.placeholder')"
        @input="onBaseUrlInput"
      />
      <template #hint>
        {{ settingsMessage('settings.addModel.apiUrl.descriptionLine1') }}<br />
        {{ settingsMessage('settings.addModel.apiUrl.descriptionLine2') }}
      </template>
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

    <!-- 发现多个模型时，直接展示列表及启用/关闭开关 -->
    <div v-if="discoveredModels.length > 0" class="custom-discovered-models-section">
      <header class="custom-discovered-models-header">
        <span class="custom-discovered-models-title">
          {{ settingsMessage('settings.addModel.discoveredModels.title').replace('{count}', String(discoveredModels.length)) }}
        </span>
        <button
          type="button"
          class="settings-link-button"
          @click="toggleAllEnabled"
        >
          {{ allEnabled ? '全部关闭' : settingsMessage('settings.addModel.discoveredModels.enableAll') }}
        </button>
      </header>

      <div class="custom-discovered-models-list">
        <SettingsList :bordered="false">
          <SettingsListRow
            v-for="model in discoveredModels"
            :key="model.id"
            :title="model.name"
            :meta="formatModelMeta(model)"
          >
            <template #trailing>
              <Switch
                :model-value="modelStateMap[model.id]?.enabled ?? true"
                :aria-label="model.name"
                @update:model-value="toggleModelEnabled(model.id, $event)"
              />
            </template>
          </SettingsListRow>
        </SettingsList>
      </div>
    </div>

    <!-- 未获取模型列表时，允许用户展开自定义手动单模型高级设置（若不想点击探测） -->
    <template v-else-if="showManualConfig">
      <SettingsRow
        :label="settingsMessage('settings.addModel.modelName.label')"
        :hint="settingsMessage('settings.addModel.api.modelName.description')"
      >
        <CustomTextInput
          v-model="form.endpointModelId"
          class="settings-text-control"
          :placeholder="settingsMessage('settings.addModel.api.modelName.placeholder')"
        />
      </SettingsRow>
    </template>

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
import { CustomSelect, CustomTextInput, SecretInput, Switch } from '@linnya/renderer-ui';
import {
  SettingsFeedback,
  SettingsList,
  SettingsListRow,
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
import { extractDefaultProviderNameFromBaseUrl } from '@app/schemas';
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
const userEditedProviderName = ref(false);
const showManualConfig = ref(true);

const isDiscovering = ref(false);
const discoveredModels = ref<DiscoveredModel[]>([]);
const modelStateMap = ref<Record<string, { enabled: boolean }>>({});
const discoveryFeedback = ref<{ kind: 'info' | 'error' | 'success'; message: string } | null>(null);

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

const allEnabled = computed(() =>
  discoveredModels.value.length > 0 &&
  discoveredModels.value.every(m => modelStateMap.value[m.id]?.enabled ?? true)
);

function onBaseUrlInput(): void {
  if (!userEditedProviderName.value && form.value.baseUrl.trim()) {
    form.value.providerName = extractDefaultProviderNameFromBaseUrl(form.value.baseUrl);
  }
}

function formatModelMeta(model: DiscoveredModel): string {
  const parts: string[] = [];
  if (model.id && model.id !== model.name) {
    parts.push(model.id);
  }
  if (model.context_window_tokens) {
    parts.push(`${Math.round(model.context_window_tokens / 1024)}k`);
  }
  if (model.supports_image_input) {
    parts.push(settingsMessage('settings.modelCapability.imageInput'));
  }
  return parts.join(' · ');
}

function toggleModelEnabled(modelId: string, enabled: boolean): void {
  modelStateMap.value[modelId] = { enabled };
}

function toggleAllEnabled(): void {
  const next = !allEnabled.value;
  for (const model of discoveredModels.value) {
    modelStateMap.value[model.id] = { enabled: next };
  }
}

function createInitialForm(): ApiCustomModelForm {
  return {
    providerName: '',
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
      modelStateMap.value = {};
      return;
    }

    discoveredModels.value = [...result.models];
    const nextMap: Record<string, { enabled: boolean }> = {};
    for (const model of result.models) {
      nextMap[model.id] = { enabled: true };
    }
    modelStateMap.value = nextMap;
    discoveryFeedback.value = null;
  } catch (error: unknown) {
    discoveredModels.value = [];
    modelStateMap.value = {};
    discoveryFeedback.value = {
      kind: 'error',
      message:
        error instanceof Error ? error.message : settingsMessage('settings.addModel.error.unknown'),
    };
  } finally {
    isDiscovering.value = false;
  }
}

async function submit(): Promise<void> {
  status.isSubmitting = true;
  status.success = false;
  status.error = null;

  try {
    let payload: ApiCustomModelForm = { ...form.value };

    if (discoveredModels.value.length > 0) {
      payload.models = discoveredModels.value.map(model => ({
        endpoint_model_id: model.id,
        display_name: model.name,
        context_window_tokens: model.context_window_tokens ?? 32768,
        max_output_tokens: model.max_output_tokens ?? 4096,
        supports_image_input: model.supports_image_input ?? false,
        picker_enabled: modelStateMap.value[model.id]?.enabled ?? true,
      }));
    }

    const result = await registerApiCustomModel(payload);
    if (!result.ok) {
      status.error = resolveRegistrationIssue(result.issue);
      return;
    }
    form.value = createInitialForm();
    userEditedProviderName.value = false;
    discoveredModels.value = [];
    modelStateMap.value = {};
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
