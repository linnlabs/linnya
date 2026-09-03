<template>
  <div class="add-model-provider-form" data-registration-kind="ollama">
    <SettingsRow
      :label="settingsMessage('settings.addModel.ollama.url.label')"
      :hint="settingsMessage('settings.addModel.ollama.url.description')"
    >
      <CustomTextInput
        v-model="form.serviceUrl"
        placeholder="http://localhost:11434"
        @blur="handleUrlBlur"
      />
      <SettingsFeedback kind="error" :message="refreshError || ''" />
    </SettingsRow>

    <SettingsRow
      :label="settingsMessage('settings.addModel.modelName.label')"
      :hint="settingsMessage('settings.addModel.ollama.model.description')"
    >
      <div class="settings-field-with-action add-model-select-with-action">
        <CustomSelect
          v-model="form.endpointModelId"
          :options="modelOptions"
          :placeholder="settingsMessage('settings.addModel.ollama.model.placeholder')"
          :title="settingsMessage('settings.addModel.ollama.model.selectTitle')"
          :disabled="modelsLoading || availableModels.length === 0 || Boolean(refreshError)"
          bordered
          class="add-model-select-control flex-grow"
          font-size="14px"
        />
        <button
          type="button"
          class="settings-inline-button add-model-refresh-button"
          :disabled="modelsLoading || !form.serviceUrl"
          :title="settingsMessage('settings.addModel.ollama.refreshTitle')"
          :aria-label="settingsMessage('settings.addModel.ollama.refreshTitle')"
          @click="refreshModels"
        >
          <RefreshIcon class="add-model-refresh-icon" :class="{ 'is-spinning': modelsLoading }" />
        </button>
      </div>
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

    <div class="add-model-submit">
      <button
        type="button"
        class="settings-button full-width-button"
        :disabled="
          status.isSubmitting || !form.endpointModelId || Boolean(refreshError) || status.success
        "
        @click="submit"
      >
        {{ submitText }}
      </button>
      <SettingsFeedback kind="error" :message="status.error || ''" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import type { CustomSelectOption } from '@linnya/renderer-ui';
import { RefreshIcon } from '@linnya/renderer-ui/icons';
import { CustomSelect } from '@linnya/renderer-ui';
import { CustomTextInput } from '@linnya/renderer-ui';
import { SettingsFeedback, SettingsRow, useSettingsLocalization } from '@/domains/settings/public';
import type {
  OllamaModelRegistrationFormValues,
  OllamaRegistrationFormStatus,
} from '../definitions/ollamaModelRegistrationForm';
import type { OllamaModelRegistrationIssue } from '../definitions/ollamaModelRegistrationResult';
import { resolveOllamaModelDiscoveryErrorPresentation } from '../functions/ollamaModelDiscoveryErrorPresentation';
import { OllamaModelRegistrationError } from '../definitions/ollamaModelRegistrationGateway';
import { createOllamaModelDiscoveryPort } from '../infrastructure/ollamaModelDiscoveryPort';
import { registerOllamaModel } from '../orchestration/registerOllamaModel';

const props = defineProps<{
  readonly providerConnectionDefinitionId: string;
  readonly refreshModelCatalog: () => Promise<void>;
}>();
const discoveryPort = createOllamaModelDiscoveryPort();
const { settingsMessage } = useSettingsLocalization();
const status = reactive<OllamaRegistrationFormStatus>({
  isSubmitting: false,
  success: false,
  error: null,
});
const form = ref<OllamaModelRegistrationFormValues>(createInitialForm());
const availableModels = ref<string[]>([]);
const modelsLoading = ref(false);
const refreshError = ref<string | null>(null);
const previousUrl = ref('');
let refreshTimer: number | null = null;
let successTimer: number | null = null;

const submitText = computed(() => {
  if (status.isSubmitting) return settingsMessage('settings.addModel.submit.adding');
  if (status.success) return settingsMessage('settings.addModel.submit.success');
  return settingsMessage('settings.addModel.submit.add');
});

const modelOptions = computed<CustomSelectOption[]>(() => {
  if (modelsLoading.value) {
    return [
      { value: '', text: settingsMessage('settings.addModel.ollama.loading'), disabled: true },
    ];
  }
  if (availableModels.value.length === 0) {
    return [{ value: '', text: settingsMessage('settings.addModel.ollama.empty'), disabled: true }];
  }
  return availableModels.value.map(modelName => ({ value: modelName, text: modelName }));
});

function createInitialForm(): OllamaModelRegistrationFormValues {
  return {
    endpointModelId: '',
    displayName: '',
    serviceUrl: 'http://localhost:11434',
    contextWindowTokens: '32768',
    maxOutputTokens: '4096',
  };
}

function resolveRegistrationIssue(issue: OllamaModelRegistrationIssue): string {
  if (issue === 'endpoint_model_id_required') {
    return settingsMessage('settings.addModel.error.ollamaModelRequired');
  }
  if (issue === 'service_url_invalid') {
    return settingsMessage('settings.addModel.ollama.urlRequired');
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
    const result = await registerOllamaModel(props.providerConnectionDefinitionId, form.value);
    if (!result.ok) {
      status.error = resolveRegistrationIssue(result.issue);
      return;
    }
    form.value = createInitialForm();
    await props.refreshModelCatalog();
    showSuccess();
    await refreshModels();
  } catch (error: unknown) {
    console.error('[CustomModelRegistration] Ollama 模型注册失败', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    status.error =
      error instanceof OllamaModelRegistrationError
        ? error.message
        : settingsMessage('settings.addModel.error.unknown');
  } finally {
    status.isSubmitting = false;
  }
}

async function refreshModels(): Promise<void> {
  if (!form.value.serviceUrl) {
    refreshError.value = settingsMessage('settings.addModel.ollama.urlRequired');
    availableModels.value = [];
    return;
  }
  modelsLoading.value = true;
  refreshError.value = null;
  availableModels.value = [];
  form.value.endpointModelId = '';
  try {
    const models = await discoveryPort.listModels(form.value.serviceUrl);
    availableModels.value = [...models];
    if (models.length === 0) {
      refreshError.value = settingsMessage('settings.addModel.ollama.noModels');
    }
    previousUrl.value = form.value.serviceUrl;
  } catch (error: unknown) {
    refreshError.value = resolveOllamaModelDiscoveryErrorPresentation(error, settingsMessage);
  } finally {
    modelsLoading.value = false;
  }
}

function handleUrlBlur(): void {
  if (form.value.serviceUrl === previousUrl.value) return;
  if (refreshTimer !== null) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    void refreshModels();
  }, 500);
}

watch(
  () => form.value.endpointModelId,
  endpointModelId => {
    if (endpointModelId && !form.value.displayName) {
      form.value.displayName = endpointModelId;
    }
  }
);

onMounted(() => {
  previousUrl.value = form.value.serviceUrl;
  void refreshModels();
});

onBeforeUnmount(() => {
  if (refreshTimer !== null) window.clearTimeout(refreshTimer);
  if (successTimer !== null) window.clearTimeout(successTimer);
});
</script>
