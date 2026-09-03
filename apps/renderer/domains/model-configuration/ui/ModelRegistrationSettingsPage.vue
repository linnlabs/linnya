<template>
  <SettingsPage>
    <SettingsSection :title="settingsMessage('settings.addModel.provider.title')">
      <SettingsRow
        :label="settingsMessage('settings.addModel.provider.label')"
        :hint="settingsMessage('settings.addModel.provider.description')"
      >
        <CustomSelect
          v-model="selectedProvider"
          :options="providerOptions"
          :title="settingsMessage('settings.addModel.provider.selectTitle')"
          font-size="14px"
        />
        <SettingsFeedback kind="error" :message="providerCatalog.error.value || ''" />
      </SettingsRow>

      <SettingsRow
        v-if="selectedProvider !== CUSTOM_PROVIDER_SELECTION && connectionOptions.length > 1"
        :label="settingsMessage('settings.addModel.connection.label')"
        :hint="settingsMessage('settings.addModel.connection.description')"
      >
        <SettingsChoiceGroup
          :model-value="selectedConnection"
          :options="connectionOptions"
          name="model-registration-connection"
          @update:model-value="selectedConnection = $event"
        />
      </SettingsRow>

      <CustomApiModelRegistrationForm
        v-if="selectedProvider === CUSTOM_PROVIDER_SELECTION"
        :refresh-model-catalog="refreshModelCatalogAfterRegistration"
      />
      <OllamaModelRegistrationForm
        v-else-if="localRuntimeProviderConnectionDefinitionId"
        :key="localRuntimeProviderConnectionDefinitionId"
        :provider-connection-definition-id="localRuntimeProviderConnectionDefinitionId"
        :refresh-model-catalog="refreshModelCatalogAfterRegistration"
      />
      <ProviderAccountModelRegistrationPanel
        v-else-if="accountProviderConnectionDefinitionId"
        :key="accountProviderConnectionDefinitionId"
        :provider-connection-definition-id="accountProviderConnectionDefinitionId"
        :refresh-model-catalog="refreshModelCatalogAfterRegistration"
      />
      <DirectProviderOnboardingPanel
        v-else-if="apiKeyProviderConnectionDefinitionId"
        :key="apiKeyProviderConnectionDefinitionId"
        :provider-connection-definition-id="apiKeyProviderConnectionDefinitionId"
        :refresh-model-catalog="refreshModelCatalogAfterRegistration"
      />
    </SettingsSection>
  </SettingsPage>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { CustomSelectOption } from '@linnya/renderer-ui';
import { CustomSelect } from '@linnya/renderer-ui';
import { useModelPickerReadModel } from '../features/model-picker';
import {
  SettingsChoiceGroup,
  SettingsFeedback,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  useSettingsLocalization,
} from '@/domains/settings/public';
import { DirectProviderOnboardingPanel } from '../features/direct-provider-onboarding';
import { CustomApiModelRegistrationForm } from '../features/custom-model-registration';
import { OllamaModelRegistrationForm } from '../features/ollama-model-registration';
import { ProviderAccountModelRegistrationPanel } from '../features/provider-account-model-registration';
import { loadProviderCatalog, useProviderCatalogReadModel } from '../features/provider-catalog';
import {
  CUSTOM_PROVIDER_SELECTION,
  type ModelRegistrationProviderSelection,
} from '../definitions/modelRegistrationProviderSelection';
import {
  buildModelRegistrationProviderOptions,
  buildModelRegistrationConnectionOptions,
  resolveAccountProviderConnectionDefinitionId,
  resolveApiKeyProviderConnectionDefinitionId,
  resolveLocalRuntimeProviderConnectionDefinitionId,
} from '../functions/buildModelRegistrationProviderOptions';
import { refreshModelCatalogAfterRegistration } from '../orchestration/refreshModelCatalogAfterRegistration';
import './ModelRegistrationSettingsPage.css';

const { settingsMessage } = useSettingsLocalization();
const providerCatalog = useProviderCatalogReadModel();
const modelPicker = useModelPickerReadModel();
const selectedProvider = ref<ModelRegistrationProviderSelection>(CUSTOM_PROVIDER_SELECTION);
const selectedConnection = ref('');

const providerOptions = computed<CustomSelectOption[]>(() =>
  buildModelRegistrationProviderOptions(
    providerCatalog.providers.value,
    {
      custom: settingsMessage('settings.addModel.provider.customOption'),
    },
    configuredConnectionIds.value
  )
);

const configuredConnectionIds = computed(
  () =>
    new Set(
      (modelPicker.snapshot.value?.providers ?? []).map(
        provider => provider.provider_connection_definition_id
      )
    )
);

const connectionOptions = computed(() =>
  buildModelRegistrationConnectionOptions(
    selectedProvider.value,
    providerCatalog.providers.value,
    configuredConnectionIds.value
  )
);
const apiKeyProviderConnectionDefinitionId = computed(() =>
  resolveApiKeyProviderConnectionDefinitionId(
    selectedConnection.value,
    providerCatalog.providers.value
  )
);
const accountProviderConnectionDefinitionId = computed(() =>
  resolveAccountProviderConnectionDefinitionId(
    selectedConnection.value,
    providerCatalog.providers.value
  )
);
const localRuntimeProviderConnectionDefinitionId = computed(() =>
  resolveLocalRuntimeProviderConnectionDefinitionId(
    selectedConnection.value,
    providerCatalog.providers.value
  )
);

watch([selectedProvider, providerOptions, connectionOptions], () => {
  if (!providerOptions.value.some(option => option.value === selectedProvider.value)) {
    selectedProvider.value = CUSTOM_PROVIDER_SELECTION;
    return;
  }
  const options = connectionOptions.value;
  const onlyValue = options.length === 1 ? options[0]?.value : '';
  selectedConnection.value = onlyValue ?? '';
});

onMounted(async () => {
  try {
    await loadProviderCatalog();
  } catch (error: unknown) {
    console.error('[ProviderCatalog] 目录加载失败', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
});
</script>
