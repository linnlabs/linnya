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
                <SettingsListRow
                  v-for="source in filteredSources"
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
              </SettingsList>
            </div>
          </div>
        </aside>

        <div
          v-if="selectedSource"
          class="model-visibility-models"
        >
          <header class="model-visibility-models-header">
            <div>
              <h4>{{ selectedSource.displayName }}</h4>
              <p v-if="selectedSource.kind === 'provider' && !selectedSource.credentialAvailable">
                {{ settingsMessage('settings.modelPicker.credentialUnavailable') }}
              </p>
            </div>
            <Switch
              v-if="selectedSource.kind === 'provider'"
              :model-value="selectedSource.pickerEnabled"
              :ariaLabel="selectedSource.displayName"
              :disabled="isMutating"
              @update:model-value="setProviderVisibility(selectedSource, $event)"
            />
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
import { CustomTextInput, Switch } from '@linnya/renderer-ui';
import {
  SettingsFeedback,
  SettingsList,
  SettingsListRow,
  SettingsSection,
  SettingsState,
  useSettingsLocalization,
} from '@/domains/settings/public';
import {
  activateModelPickerProviderModel,
  loadModelPicker,
  setModelPickerModelVisibility,
  setModelPickerProviderVisibility,
  useModelPickerReadModel,
} from '../index';
import {
  filterModelVisibilityModels,
  filterModelVisibilitySources,
  projectModelVisibilitySources,
  type ModelVisibilitySource,
} from '../functions/projectModelVisibilitySources';
import './ModelVisibilitySettingsSection.css';

const modelPicker = useModelPickerReadModel();
const modelCatalog = useModelCatalogReadModel();
const { settingsMessage } = useSettingsLocalization();
const sourceQuery = ref('');
const modelQuery = ref('');
const selectedSourceId = ref<string | null>(null);
const selectedModelDetails = ref<ModelCatalogItem | null>(null);

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
const selectedSource = computed(
  () => sources.value.find(source => source.id === selectedSourceId.value) ?? null
);
const filteredModels = computed(() =>
  selectedSource.value ? filterModelVisibilityModels(selectedSource.value, modelQuery.value) : []
);
const isMutating = computed(
  () => modelPicker.activeOperation.value !== null && modelPicker.activeOperation.value !== 'load'
);
const isSelectedSourceDisabled = computed(
  () => selectedSource.value?.kind === 'provider' && !selectedSource.value.pickerEnabled
);
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
    selectedSource.value?.kind === 'custom' &&
    model.materialized &&
    modelCatalog.activeOperation.value === null &&
    editableModelsById.value.has(model.model_config_id)
  );
}

function openCustomModelDetails(model: ModelPickerProviderModel): void {
  if (selectedSource.value?.kind !== 'custom' || !model.materialized) return;
  const currentModel = editableModelsById.value.get(model.model_config_id);
  if (!currentModel) return;
  selectedModelDetails.value = { ...currentModel };
}

function closeModelDetails(): void {
  selectedModelDetails.value = null;
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
  await activateModelPickerProviderModel(
    selectedSource.value.configuredProviderId,
    model.provider_model_id
  );
}
</script>
