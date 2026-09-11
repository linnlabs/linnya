<template>
  <SettingsSection :description="settingsMessage('settings.modelPicker.description')">
    <SettingsState
      v-if="modelPicker.activeOperation.value === 'load' && !modelPicker.snapshot.value"
      kind="loading"
      :message="settingsMessage('settings.modelPicker.loading')"
    />
    <SettingsFeedback
      v-else-if="modelPicker.error.value && !modelPicker.snapshot.value"
      kind="error"
      :message="modelPicker.error.value.detail ?? settingsMessage('settings.modelPicker.failure')"
    />
    <SettingsState
      v-else-if="sources.length === 0"
      kind="empty"
      :message="settingsMessage('settings.modelPicker.empty')"
    />
    <template v-else>
      <SettingsFeedback
        v-if="modelPicker.error.value"
        kind="error"
        :message="modelPicker.error.value.detail ?? settingsMessage('settings.modelPicker.failure')"
      />
      <div class="model-visibility-layout">
        <aside class="model-visibility-sources">
          <header class="model-visibility-sources-header">
            <h4>{{ settingsMessage('settings.modelGroups.provider') }}</h4>
          </header>
          <CustomTextInput
            v-model="sourceQuery"
            type="search"
            size="compact"
            :bordered="false"
            clearable
            :placeholder="settingsMessage('settings.modelPicker.sourceSearch')"
          />
          <div class="model-visibility-scroll-host">
            <div class="model-visibility-source-list">
              <SettingsList :bordered="false">
                <!-- 标准 / 官方提供商 -->
                <SettingsListRow
                  v-for="source in standardSources"
                  :key="source.id"
                  :class="{ 'is-active': source.id === selectedSourceId }"
                >
                  <template #title>
                    <button
                      type="button"
                      class="model-visibility-source-tab"
                      :aria-pressed="source.id === selectedSourceId"
                      @click="selectedSourceId = source.id"
                    >
                      <span>{{ source.displayName }}</span>
                    </button>
                  </template>
                </SettingsListRow>

                <!-- 自定义模型供应商 分组 -->
                <template v-if="customSources.length > 0">
                  <div class="model-visibility-source-group-title">
                    {{ settingsMessage('settings.modelPicker.customProviders') }}
                  </div>
                  <SettingsListRow
                    v-for="source in customSources"
                    :key="source.id"
                    :class="{ 'is-active': source.id === selectedSourceId }"
                  >
                    <template #title>
                      <button
                        type="button"
                        class="model-visibility-source-tab"
                        :aria-pressed="source.id === selectedSourceId"
                        @click="selectedSourceId = source.id"
                      >
                        <span>{{ source.displayName }}</span>
                      </button>
                    </template>
                  </SettingsListRow>
                </template>
              </SettingsList>
            </div>
          </div>
        </aside>

        <div
          v-if="selectedSource"
          class="model-visibility-models"
        >
          <header class="model-visibility-models-header">
            <div class="model-visibility-models-header-left">
              <h4>{{ selectedSource.displayName }}</h4>
              <HoverTooltip :text="settingsMessage('settings.modelPicker.refreshModels')">
                <button
                  type="button"
                  class="model-visibility-refresh-btn"
                  :disabled="isRefreshingSourceId === selectedSource.id"
                  @click.stop="refreshSourceModels(selectedSource)"
                >
                  <RefreshIcon
                    class="icon"
                    :class="{ 'is-spinning': isRefreshingSourceId === selectedSource.id }"
                  />
                </button>
              </HoverTooltip>
            </div>
            <div
              v-if="selectedSource.kind === 'provider'"
              class="model-visibility-provider-actions"
            >
              <button
                type="button"
                class="model-visibility-provider-delete"
                :aria-label="settingsMessage('settings.modelPicker.removeProvider')"
                :title="settingsMessage('settings.modelPicker.removeProvider')"
                :disabled="isMutating"
                @click="removeSelectedProvider"
              >
                <DeleteIcon />
              </button>
              <Switch
                :model-value="selectedSource.pickerEnabled"
                :ariaLabel="selectedSource.displayName"
                :disabled="isMutating"
                @update:model-value="setProviderVisibility(selectedSource, $event)"
              />
            </div>
          </header>
          <div
            class="model-visibility-models-content"
            :class="{ 'is-disabled': isSelectedSourceDisabled }"
            :aria-disabled="isSelectedSourceDisabled"
          >
            <CustomTextInput
              v-model="modelQuery"
              type="search"
              size="compact"
              :bordered="false"
              clearable
              :disabled="isSelectedSourceDisabled"
              :placeholder="settingsMessage('settings.modelPicker.modelSearch')"
            />
            <div class="model-visibility-scroll-host">
              <div class="model-visibility-model-list">
                <SettingsList :bordered="false">
                  <SettingsListRow
                    v-for="model in filteredModels"
                    :key="modelKey(model)"
                    :title="model.display_name"
                    :meta="modelStateLabel(model)"
                    :interactive="isCustomModelEditable(model)"
                    @select="openCustomModelDetails(model)"
                  >
                    <template
                      v-if="selectedSource.kind !== 'cloud'"
                      #trailing
                    >
                      <Switch
                        :model-value="model.materialized && model.picker_enabled"
                        :ariaLabel="model.display_name"
                        :disabled="isModelToggleDisabled(model)"
                        @update:model-value="setModelVisibility(model, $event)"
                      />
                    </template>
                  </SettingsListRow>
                </SettingsList>
              </div>
            </div>
          </div>
          <div
            v-if="selectedSource.kind === 'provider' && !selectedSource.credentialAvailable"
            class="model-visibility-credential-actions"
          >
            <SettingsFeedback
              kind="error"
              :message="credentialUnavailableMessage"
            />
            <ActionButtons
              :primary-action-text="settingsMessage('settings.modelPicker.removeProvider')"
              primary-variant="danger"
              :is-primary-action-disabled="isMutating || isRemovingProvider"
              @primary-click="removeSelectedProvider"
            />
          </div>
          <SettingsFeedback
            v-if="removalError"
            kind="error"
            :message="removalError"
          />
        </div>
      </div>
      <ModelDetailsModal
        :show="selectedModelDetails !== null"
        :model="selectedModelDetails"
        @close="closeModelDetails"
        @update-success="handleModelDetailsSuccess"
      />
    </template>
  </SettingsSection>
</template>

<script setup lang="ts">
import type { ModelPickerProviderModel } from '@app/schemas/model-picker';
import { computed, ref, watch } from 'vue';

import type { ModelCatalogItem } from '../../model-catalog';
import { ModelDetailsModal, useModelCatalogReadModel } from '../../model-catalog';
import { ActionButtons, CustomTextInput, HoverTooltip, Switch } from '@linnya/renderer-ui';
import { DeleteIcon, RefreshIcon } from '@linnya/renderer-ui/icons';
import { confirm } from '@shared/composables/confirmDialog';
import {
  SettingsFeedback,
  SettingsList,
  SettingsListRow,
  SettingsSection,
  SettingsState,
  useSettingsLocalization,
} from '@/domains/settings/public';
import {
  loadModelPicker,
  setModelPickerModelVisibility,
  setModelPickerProviderVisibility,
  useModelPickerReadModel,
} from '../index';
import { removeConfiguredProvider } from '../../../orchestration/removeConfiguredProvider';
import { registerApiCustomModel } from '../../custom-model-registration/orchestration/registerApiCustomModel';
import { httpCustomApiModelRegistrationGateway } from '../../custom-model-registration/infrastructure/httpCustomApiModelRegistrationGateway';
import {
  filterModelVisibilityModels,
  filterModelVisibilitySources,
  projectModelVisibilitySources,
  type ModelVisibilitySource,
} from '../functions/projectModelVisibilitySources';
import './ModelVisibilitySettingsSection.css';

const props = defineProps<{
  readonly activateProviderModel: (
    configuredProviderId: string,
    providerModelId: string
  ) => Promise<void>;
}>();

const modelPicker = useModelPickerReadModel();
const modelCatalog = useModelCatalogReadModel();
const { settingsMessage } = useSettingsLocalization();
const sourceQuery = ref('');
const modelQuery = ref('');
const selectedSourceId = ref<string | null>(null);
const selectedModelDetails = ref<ModelCatalogItem | null>(null);
const isRemovingProvider = ref(false);
const removalError = ref<string | null>(null);

const sources = computed(() =>
  modelPicker.snapshot.value
    ? projectModelVisibilitySources(
        modelPicker.snapshot.value,
        settingsMessage('settings.modelPicker.customModels')
      )
    : []
);

const filteredSources = computed(() =>
  filterModelVisibilitySources(sources.value, sourceQuery.value)
);

const standardSources = computed(() =>
  filteredSources.value.filter(s => s.kind !== 'custom_provider' && s.kind !== 'custom')
);

const customSources = computed(() =>
  filteredSources.value.filter(s => s.kind === 'custom_provider' || s.kind === 'custom')
);

const isRefreshingSourceId = ref<string | null>(null);

async function refreshSourceModels(source: ModelVisibilitySource): Promise<void> {
  if (isRefreshingSourceId.value) return;
  isRefreshingSourceId.value = source.id;
  try {
    if (source.kind === 'custom_provider' && source.baseUrl && source.apiFormat) {
      const result = await httpCustomApiModelRegistrationGateway.discoverModels?.({
        api_format: source.apiFormat,
        base_url: source.baseUrl,
      });
      if (result && result.models.length > 0) {
        // 同步已有模型，添加新模型
        const existingModelMap = new Map(source.models.map(m => [m.provider_model_id, m]));
        const newModelsToAdd = result.models.filter(m => !existingModelMap.has(m.id));
        if (newModelsToAdd.length > 0) {
          await registerApiCustomModel({
            providerName: source.providerName,
            endpointModelId: '',
            displayName: '',
            credentialSecret: '',
            baseUrl: source.baseUrl,
            customApiFormat: source.apiFormat,
            contextWindowTokens: '256000',
            maxOutputTokens: '16384',
            supportsImageInput: false,
            models: newModelsToAdd.map(m => ({
              endpoint_model_id: m.id,
              display_name: m.name,
              context_window_tokens: m.context_window_tokens ?? 32768,
              max_output_tokens: m.max_output_tokens ?? 4096,
              supports_image_input: m.supports_image_input ?? false,
              picker_enabled: true,
            })),
          });
        }
      }
    }
    await loadModelPicker();
  } catch (error) {
    console.error('[ModelVisibility] 刷新供应商模型列表失败', error);
  } finally {
    isRefreshingSourceId.value = null;
  }
}
const selectedSource = computed(
  () => sources.value.find(source => source.id === selectedSourceId.value) ?? null
);
const filteredModels = computed(() =>
  selectedSource.value ? filterModelVisibilityModels(selectedSource.value, modelQuery.value) : []
);
const isMutating = computed(
  () =>
    (modelPicker.activeOperation.value !== null && modelPicker.activeOperation.value !== 'load') ||
    modelCatalog.activeOperation.value !== null ||
    isRemovingProvider.value
);
const isSelectedSourceDisabled = computed(
  () => selectedSource.value?.kind === 'provider' && !selectedSource.value.pickerEnabled
);
const credentialUnavailableMessage = computed(() => {
  const reason = selectedSource.value?.kind === 'provider'
    ? selectedSource.value.credentialUnavailableReason
    : undefined;
  if (!reason) return settingsMessage('settings.modelPicker.credentialUnavailable');
  const messageKeys = {
    missing: 'settings.modelPicker.credentialReason.missing',
    temporarily_unavailable: 'settings.modelPicker.credentialReason.temporarilyUnavailable',
    invalidated: 'settings.modelPicker.credentialReason.invalidated',
    malformed_ciphertext: 'settings.modelPicker.credentialReason.malformedCiphertext',
    unknown: 'settings.modelPicker.credentialReason.unknown',
  } as const;
  return settingsMessage(messageKeys[reason]);
});
const editableModelsById = computed(
  () => new Map(modelCatalog.models.value.map(model => [model.id, model]))
);

watch(
  sources,
  nextSources => {
    if (!nextSources.some(source => source.id === selectedSourceId.value)) {
      selectedSourceId.value = nextSources[0]?.id ?? null;
    }
  },
  { immediate: true }
);

function modelKey(model: ModelPickerProviderModel): string {
  return model.materialized ? model.model_config_id : model.provider_model_id;
}

function modelStateLabel(model: ModelPickerProviderModel): string {
  if (!model.materialized) return '';
  if (!model.runtime_available) return settingsMessage('settings.modelPicker.runtimeUnavailable');
  if (model.capabilities.includes('image_generation')) {
    return settingsMessage('settings.modelPicker.imageGeneration');
  }
  return model.provider_model_id ?? '';
}

function isCustomModelEditable(model: ModelPickerProviderModel): boolean {
  return (
    (selectedSource.value?.kind === 'custom' || selectedSource.value?.kind === 'custom_provider') &&
    model.materialized &&
    modelCatalog.activeOperation.value === null &&
    editableModelsById.value.has(model.model_config_id)
  );
}

function openCustomModelDetails(model: ModelPickerProviderModel): void {
  if (
    (selectedSource.value?.kind !== 'custom' && selectedSource.value?.kind !== 'custom_provider') ||
    !model.materialized
  )
    return;
  const currentModel = editableModelsById.value.get(model.model_config_id);
  if (!currentModel) return;
  selectedModelDetails.value = { ...currentModel };
}

function closeModelDetails(): void {
  selectedModelDetails.value = null;
}

async function removeSelectedProvider(): Promise<void> {
  const source = selectedSource.value;
  if (source?.kind !== 'provider' || isRemovingProvider.value) return;
  const confirmed = await confirm({
    message: settingsMessage('settings.modelPicker.removeProvider.confirm'),
    isDangerousAction: true,
  });
  if (!confirmed) return;

  isRemovingProvider.value = true;
  removalError.value = null;
  try {
    const modelConfigIds = source.models
      .filter(model => model.materialized)
      .map(model => model.model_config_id);
    await removeConfiguredProvider(modelConfigIds);
  } catch (error: unknown) {
    console.error('[ModelVisibility] 删除 Provider 失败', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    removalError.value = settingsMessage('settings.modelPicker.removeProvider.failed');
  } finally {
    isRemovingProvider.value = false;
  }
}

function handleModelDetailsSuccess(operation: 'update' | 'delete'): void {
  closeModelDetails();
  if (operation === 'delete') return;
  void loadModelPicker().catch(error => {
    console.warn('[ModelVisibility] 模型更新后刷新快捷选择投影失败', error);
  });
}

function isModelToggleDisabled(model: ModelPickerProviderModel): boolean {
  if (isMutating.value) return true;
  if (isSelectedSourceDisabled.value) return true;
  if (model.materialized) return false;
  return selectedSource.value?.kind !== 'provider' || !selectedSource.value.credentialAvailable;
}

async function setProviderVisibility(
  source: Extract<ModelVisibilitySource, { kind: 'provider' }>,
  visible: boolean
): Promise<void> {
  await setModelPickerProviderVisibility(source.configuredProviderId, visible);
}

async function setModelVisibility(
  model: ModelPickerProviderModel,
  visible: boolean
): Promise<void> {
  if (model.materialized) {
    await setModelPickerModelVisibility(model.model_config_id, visible);
    return;
  }
  if (!visible || selectedSource.value?.kind !== 'provider') return;
  await props.activateProviderModel(
    selectedSource.value.configuredProviderId,
    model.provider_model_id
  );
}
</script>
