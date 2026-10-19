<template>
  <SettingsSection :description="settingsMessage('settings.modelPicker.description')">
    <SettingsFeedback
      v-if="removalError || modelPicker.error.value"
      kind="error"
      :message="removalError ?? modelPickerErrorMessage"
    />
    <SettingsState
      v-if="modelPicker.activeOperation.value === 'load' && !modelPicker.snapshot.value"
      kind="loading"
      :message="settingsMessage('settings.modelPicker.loading')"
    />
    <SettingsState
      v-else-if="sources.length === 0 && modelPicker.snapshot.value"
      kind="empty"
      :message="settingsMessage('settings.modelPicker.empty')"
    />
    <template v-else-if="sources.length > 0">
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
              <HoverTooltip
                v-if="selectedSource.kind === 'provider' || selectedSource.kind === 'custom_provider'"
                :text="refreshUnavailableMessage || refreshLabel"
              >
                <IconButton
                  :label="refreshLabel"
                  size="xs"
                  class="model-visibility-refresh-btn"
                  :disabled="!canRefreshSelectedSource || isRefreshingSourceId !== null || isMutating"
                  @click.stop="refreshSourceModels(selectedSource)"
                >
                  <RefreshIcon
                    class="icon"
                    :class="{ 'is-spinning': isRefreshingSourceId === selectedSource.id }"
                  />
                </IconButton>
              </HoverTooltip>
            </div>
            <div
              v-if="selectedSource.kind === 'provider'"
              class="model-visibility-provider-actions"
            >
              <IconButton
                v-if="selectedSource.credentialKind === 'api_key'"
                :label="settingsMessage('settings.modelPicker.replaceApiKey')"
                class="model-visibility-provider-edit"
                :disabled="isMutating"
                @click="openCredentialReplacement(selectedSource)"
              >
                <EditIcon />
              </IconButton>
              <IconButton
                :label="settingsMessage('settings.modelPicker.removeProvider')"
                tone="danger"
                class="model-visibility-provider-delete"
                :disabled="isMutating"
                @click="removeSelectedProvider"
              >
                <DeleteIcon />
              </IconButton>
              <Switch
                :model-value="selectedSource.pickerEnabled"
                v-bind="{ ariaLabel: selectedSource.displayName }"
                :disabled="isMutating"
                @update:model-value="setProviderVisibility(selectedSource, $event)"
              />
            </div>
            <div
              v-else-if="selectedSource.kind === 'custom_provider'"
              class="model-visibility-provider-actions"
            >
              <IconButton
                :label="settingsMessage('settings.modelPicker.editProvider')"
                class="model-visibility-provider-edit"
                :disabled="isMutating"
                @click="openCustomProviderEdit(selectedSource)"
              >
                <EditIcon />
              </IconButton>
              <IconButton
                :label="settingsMessage('settings.modelPicker.removeProvider')"
                tone="danger"
                class="model-visibility-provider-delete"
                :disabled="isMutating"
                @click="removeSelectedCustomProvider(selectedSource)"
              >
                <DeleteIcon />
              </IconButton>
            </div>
          </header>
          <SettingsFeedback
            v-if="refreshUnavailableMessage"
            kind="info"
            :message="refreshUnavailableMessage"
          />
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
                        v-bind="{ ariaLabel: model.display_name }"
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
              v-if="selectedSource.credentialKind === 'api_key'"
              :primary-action-text="settingsMessage('settings.modelPicker.replaceApiKey')"
              :secondary-action-text="settingsMessage('settings.modelPicker.removeProvider')"
              :is-primary-action-disabled="isMutating"
              :is-secondary-action-disabled="isMutating"
              @primary-click="openCredentialReplacement(selectedSource)"
              @secondary-click="removeSelectedProvider"
            />
            <ActionButtons
              v-else
              :primary-action-text="settingsMessage('settings.modelPicker.removeProvider')"
              primary-variant="danger"
              :is-primary-action-disabled="isMutating || isRemovingProvider"
              @primary-click="removeSelectedProvider"
            />
          </div>
        </div>
      </div>
      <ModelDetailsModal
        :show="selectedModelDetails !== null"
        :model="selectedModelDetails"
        @close="closeModelDetails"
        @update-success="handleModelDetailsSuccess"
      />
      <CustomApiProviderEditModal
        v-if="editingCustomProvider"
        :provider="editingCustomProvider"
        @close="editingCustomProvider = null"
        @saved="handleCustomProviderSaved"
      />
      <DirectProviderCredentialModal
        v-if="replacingCredentialProvider"
        :provider-connection-definition-id="
          replacingCredentialProvider.providerConnectionDefinitionId
        "
        :provider-name="replacingCredentialProvider.displayName"
        @close="replacingCredentialProvider = null"
        @saved="handleCredentialReplaced"
      />
    </template>
  </SettingsSection>
</template>

<script setup lang="ts">
import type { ModelPickerProviderModel } from '@app/schemas/model-picker';
import { computed, ref, watch } from 'vue';

import type { ModelCatalogItem } from '../../model-catalog';
import { ModelDetailsModal, useModelCatalogReadModel } from '../../model-catalog';
import {
  CustomApiProviderEditModal,
  type CustomApiProviderConnection,
} from '../../custom-model-registration';
import { DirectProviderCredentialModal } from '../../direct-provider-onboarding';
import { ActionButtons, CustomTextInput, HoverTooltip, IconButton, Switch } from '@linnya/renderer-ui';
import { DeleteIcon, EditIcon, RefreshIcon } from '@linnya/renderer-ui/icons';
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
  refreshModelPickerProvider,
  setModelPickerModelVisibility,
  setModelPickerProviderVisibility,
  useModelPickerReadModel,
} from '../index';
import { refreshModelCatalogAfterRegistration } from '../../../orchestration/refreshModelCatalogAfterRegistration';
import { removeCustomApiProviderModels } from '../../../orchestration/removeCustomApiProviderModels';
import { removeModelSource } from '../../../orchestration/removeModelSource';
import { refreshCustomApiProviderModels } from '../../../orchestration/refreshCustomApiProviderModels';
import {
  filterModelVisibilityModels,
  filterModelVisibilitySources,
  projectModelVisibilitySources,
  type ModelVisibilitySource,
} from '../functions/projectModelVisibilitySources';
import { resolveModelPickerErrorPresentation } from '../functions/modelPickerErrorPresentation';
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
const modelPickerErrorMessage = computed(() =>
  modelPicker.error.value
    ? resolveModelPickerErrorPresentation(modelPicker.error.value, settingsMessage)
    : ''
);
const sourceQuery = ref('');
const modelQuery = ref('');
const selectedSourceId = ref<string | null>(
  modelPicker.managementProviderId.value ? `provider:${modelPicker.managementProviderId.value}` : null
);
const selectedModelDetails = ref<ModelCatalogItem | null>(null);
const isRemovingProvider = ref(false);
const removalError = ref<string | null>(null);
const editingCustomProvider = ref<CustomApiProviderConnection | null>(null);
const replacingCredentialProvider = ref<{
  readonly providerConnectionDefinitionId: string;
  readonly displayName: string;
} | null>(null);

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
    if (source.kind === 'provider') {
      await refreshModelPickerProvider(source.configuredProviderId, source.displayName);
      return;
    }
    if (source.kind === 'custom_provider') {
      await refreshCustomApiProviderModels(source.providerName, source.displayName);
    }
  } catch {
    // 操作 owner 已把带来源名称的错误发布到页面；这里不再维护第二份错误状态。
  } finally {
    isRefreshingSourceId.value = null;
  }
}
const selectedSource = computed(
  () => sources.value.find(source => source.id === selectedSourceId.value) ?? null
);
const refreshLabel = computed(() =>
  settingsMessage(
    isRefreshingSourceId.value === selectedSource.value?.id
      ? 'settings.modelPicker.refreshingModels'
      : selectedSource.value?.kind === 'custom_provider'
        ? 'settings.modelPicker.synchronizeModels'
        : 'settings.modelPicker.refreshModels'
  )
);
const canRefreshSelectedSource = computed(() => {
  const source = selectedSource.value;
  return source?.kind === 'provider'
    ? source.canRefreshModels
    : source?.kind === 'custom_provider' && Boolean(source.baseUrl && source.apiFormat);
});
const refreshUnavailableMessage = computed(() => {
  const source = selectedSource.value;
  if (source?.kind !== 'provider' || source.canRefreshModels) return '';
  return settingsMessage(
    source.credentialKind === 'none'
      ? 'settings.modelPicker.localRefreshUnavailable'
      : 'settings.modelPicker.refreshUnavailable'
  );
});
const filteredModels = computed(() =>
  selectedSource.value ? filterModelVisibilityModels(selectedSource.value, modelQuery.value) : []
);
const isMutating = computed(
  () =>
    isRefreshingSourceId.value !== null ||
    (modelPicker.activeOperation.value !== null && modelPicker.activeOperation.value !== 'load') ||
    modelCatalog.activeOperation.value !== null ||
    isRemovingProvider.value
);
const isSelectedSourceDisabled = computed(
  () => selectedSource.value?.kind === 'provider' && !selectedSource.value.pickerEnabled
);
const credentialUnavailableMessage = computed(() => {
  const reason =
    selectedSource.value?.kind === 'provider'
      ? selectedSource.value.credentialUnavailableReason
      : undefined;
  if (!reason) return settingsMessage('settings.modelPicker.credentialUnavailable');
  const messageKeys = {
    missing: 'settings.modelPicker.credentialReason.missing',
    temporarily_unavailable: 'settings.modelPicker.credentialReason.temporarilyUnavailable',
    invalidated: 'settings.modelPicker.credentialReason.invalidated',
    malformed_ciphertext: 'settings.modelPicker.credentialReason.malformedCiphertext',
    migration_required: 'settings.modelPicker.credentialReason.migrationRequired',
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
  if (!model.materialized) return model.activation_unavailable_reason ?? model.provider_model_id;
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
    const result = await removeModelSource(modelConfigIds);
    if (result.failure) {
      removalError.value = settingsMessage('settings.modelPicker.removeProvider.partialFailed', {
        removed: result.removedModelIds.length,
        total: modelConfigIds.length,
      });
    } else if (result.synchronizationFailed) {
      removalError.value = settingsMessage('settings.modelPicker.modelsRemovedSyncFailed');
    }
  } catch (error: unknown) {
    console.error('[ModelVisibility] 删除 Provider 失败', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    removalError.value = settingsMessage('settings.modelPicker.removeProvider.failed');
  } finally {
    isRemovingProvider.value = false;
  }
}

async function removeSelectedCustomProvider(
  source: Extract<ModelVisibilitySource, { kind: 'custom_provider' }>
): Promise<void> {
  if (isRemovingProvider.value) return;
  const confirmed = await confirm({
    message: settingsMessage('settings.modelPicker.removeCustomProvider.confirm', {
      providerName: source.displayName,
      count: source.models.length,
    }),
    isDangerousAction: true,
  });
  if (!confirmed) return;

  isRemovingProvider.value = true;
  removalError.value = null;
  try {
    const result = await removeCustomApiProviderModels(source.providerName);
    if (result.synchronizationFailed)
      removalError.value = settingsMessage('settings.modelPicker.removedSyncFailed');
  } catch (error: unknown) {
    console.error('[ModelVisibility] 删除自定义模型供应商失败', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    removalError.value = settingsMessage('settings.modelPicker.removeProvider.failed');
  } finally {
    isRemovingProvider.value = false;
  }
}

function openCustomProviderEdit(
  source: Extract<ModelVisibilitySource, { kind: 'custom_provider' }>
): void {
  editingCustomProvider.value = {
    providerName: source.providerName,
    ...(source.apiFormat ? { apiFormat: source.apiFormat } : {}),
    ...(source.baseUrl ? { baseUrl: source.baseUrl } : {}),
  };
}

function handleCustomProviderSaved(): void {
  editingCustomProvider.value = null;
  void refreshModelCatalogAfterRegistration().catch(error => {
    console.warn('[ModelVisibility] 供应商更新后刷新模型目录失败', error);
  });
}

function openCredentialReplacement(
  source: Extract<ModelVisibilitySource, { kind: 'provider' }>
): void {
  replacingCredentialProvider.value = {
    providerConnectionDefinitionId: source.providerConnectionDefinitionId,
    displayName: source.displayName,
  };
}

function handleCredentialReplaced(): void {
  replacingCredentialProvider.value = null;
  void loadModelPicker().catch(error => {
    console.warn('[ModelVisibility] API Key 更新后刷新快捷选择投影失败', error);
  });
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
  if (model.activation_unavailable_reason) return true;
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
