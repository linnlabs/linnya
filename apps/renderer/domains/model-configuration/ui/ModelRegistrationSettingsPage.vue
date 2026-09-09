<template>
  <SettingsPage class="model-registration-settings-page">
    <SettingsSection
      v-if="showQuickStart"
      :title="settingsMessage('settings.addModel.quick.title')"
      :description="settingsMessage('settings.addModel.quick.description')"
    >
      <div
        class="model-registration-quick-options"
        role="group"
        :aria-label="settingsMessage('settings.addModel.quick.title')"
      >
        <button
          v-for="option in commonProviderOptions"
          :key="option.value"
          type="button"
          class="model-registration-quick-option"
          @click="enterProvider(option.value, option.preferredConnectionDefinitionId)"
        >
          <span class="model-registration-quick-option-label">{{ option.text }}</span>
          <ChevronIcon
            direction="right"
            class="model-registration-quick-option-icon"
          />
        </button>

        <div class="model-registration-other-provider">
          <CustomSelect
            v-model="selectedOtherProvider"
            :options="otherProviderOptions"
            :placeholder="settingsMessage('settings.addModel.quick.other')"
            :title="settingsMessage('settings.addModel.quick.otherSelectTitle')"
            :trigger-aria-label="settingsMessage('settings.addModel.quick.otherSelectTitle')"
            :disabled="otherProviderOptions.length === 0"
            :bordered="false"
            :use-portal-to-body="true"
            :class-names="otherProviderSelectClassNames"
            min-width="100%"
          >
            <template #arrow-icon="{ isOpen }">
              <ChevronIcon
                direction="right"
                class="model-registration-quick-option-icon"
                :class="{ 'is-open': isOpen }"
              />
            </template>
          </CustomSelect>
          <SettingsFeedback
            v-if="otherProviderOptions.length === 0 && !providerCatalog.isLoading.value"
            kind="info"
            :message="settingsMessage('settings.addModel.quick.otherEmpty')"
          />
        </div>

        <button
          type="button"
          class="model-registration-quick-option"
          @click="enterCustomProvider"
        >
          <span class="model-registration-quick-option-label">
            {{ settingsMessage('settings.addModel.quick.customApi') }}
          </span>
          <ChevronIcon
            direction="right"
            class="model-registration-quick-option-icon"
          />
        </button>
      </div>

      <SettingsFeedback
        kind="error"
        :message="providerCatalog.error.value || ''"
      />
    </SettingsSection>

    <template v-else>
      <button
        type="button"
        class="model-registration-back-button"
        @click="returnToQuickStart"
      >
        <ChevronIcon
          direction="left"
          class="model-registration-back-icon"
        />
        {{ settingsMessage('settings.addModel.quick.back') }}
      </button>

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
          <SettingsFeedback
            kind="error"
            :message="providerCatalog.error.value || ''"
          />
        </SettingsRow>

        <SettingsRow
          v-if="selectedProvider !== CUSTOM_PROVIDER_SELECTION && connectionOptions.length > 1"
          control="field"
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
    </template>
  </SettingsPage>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { CustomSelectClassNames, CustomSelectOption } from '@linnya/renderer-ui';
import { CustomSelect } from '@linnya/renderer-ui';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
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
  buildModelRegistrationCommonProviderOptions,
  buildModelRegistrationConnectionOptions,
  buildModelRegistrationOtherProviderOptions,
  buildModelRegistrationProviderOptions,
  resolveAccountProviderConnectionDefinitionId,
  resolveApiKeyProviderConnectionDefinitionId,
  resolveLocalRuntimeProviderConnectionDefinitionId,
} from '../functions/buildModelRegistrationProviderOptions';
import { refreshModelCatalogAfterRegistration } from '../orchestration/refreshModelCatalogAfterRegistration';
import './ModelRegistrationSettingsPage.css';

const { settingsMessage } = useSettingsLocalization();
const providerCatalog = useProviderCatalogReadModel();
const modelPicker = useModelPickerReadModel();

const showQuickStart = ref(true);
const selectedProvider = ref<ModelRegistrationProviderSelection>(CUSTOM_PROVIDER_SELECTION);
const selectedConnection = ref('');
const selectedOtherProvider = ref<ModelRegistrationProviderSelection | null>(null);
const preferredConnectionDefinitionId = ref<string | null>(null);
const otherProviderSelectClassNames: CustomSelectClassNames = {
  trigger: 'model-registration-quick-option',
  selectedValue: 'model-registration-quick-option-label',
};

const configuredConnectionIds = computed(
  () =>
    new Set(
      (modelPicker.snapshot.value?.providers ?? []).map(
        provider => provider.provider_connection_definition_id
      )
    )
);

const providerOptions = computed<CustomSelectOption[]>(() =>
  buildModelRegistrationProviderOptions(
    providerCatalog.providers.value,
    {
      custom: settingsMessage('settings.addModel.provider.customOption'),
    },
    configuredConnectionIds.value
  )
);

const commonProviderOptions = computed(() =>
  buildModelRegistrationCommonProviderOptions(
    providerCatalog.providers.value,
    configuredConnectionIds.value
  )
);

const otherProviderOptions = computed<CustomSelectOption[]>(() =>
  buildModelRegistrationOtherProviderOptions(
    providerCatalog.providers.value,
    configuredConnectionIds.value
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

/** 选择首屏入口后进入原有详情页，保留 Provider 下拉和接入方式选择。 */
function enterProvider(
  provider: ModelRegistrationProviderSelection,
  preferredConnectionId?: string
): void {
  preferredConnectionDefinitionId.value = preferredConnectionId ?? null;
  selectedProvider.value = provider;
  selectedConnection.value = preferredConnectionId ? `connection:${preferredConnectionId}` : '';
  showQuickStart.value = false;
}

function enterCustomProvider(): void {
  enterProvider(CUSTOM_PROVIDER_SELECTION);
}

function isProviderSelection(value: string): value is `provider:${string}` {
  return value.startsWith('provider:');
}

function handleOtherProviderSelection(value: string | number | boolean | null): void {
  if (typeof value !== 'string' || !isProviderSelection(value)) return;
  enterProvider(value);
}

function returnToQuickStart(): void {
  showQuickStart.value = true;
  selectedOtherProvider.value = null;
  preferredConnectionDefinitionId.value = null;
}

watch([selectedProvider, providerOptions, connectionOptions], () => {
  if (!providerOptions.value.some(option => option.value === selectedProvider.value)) {
    selectedProvider.value = CUSTOM_PROVIDER_SELECTION;
    selectedConnection.value = '';
    preferredConnectionDefinitionId.value = null;
    return;
  }

  const options = connectionOptions.value;
  const preferred = preferredConnectionDefinitionId.value;
  if (preferred) {
    const preferredValue = `connection:${preferred}`;
    if (options.some(option => option.value === preferredValue)) {
      selectedConnection.value = preferredValue;
      preferredConnectionDefinitionId.value = null;
      return;
    }
    preferredConnectionDefinitionId.value = null;
  }

  const onlyValue = options.length === 1 ? options[0]?.value : '';
  selectedConnection.value = onlyValue ?? '';
});

watch(selectedOtherProvider, value => {
  if (value) handleOtherProviderSelection(value);
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
