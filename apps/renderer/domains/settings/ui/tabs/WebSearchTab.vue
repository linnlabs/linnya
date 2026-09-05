<template>
  <SettingsPage>
    <SettingsSection :title="settingsMessage('settings.webSearch.engine.title')">
      <SettingsChoiceGroup
        :model-value="engine"
        :options="engineOptions"
        name="web-search-engine"
        :busy="loading"
        @update:model-value="selectEngineValue"
      />
      <p
        v-if="engine === 'parallel_free' || engine === 'duckduckgo'"
        class="settings-note"
      >
        {{ settingsMessage('settings.webSearch.engine.freeHint') }}
      </p>
    </SettingsSection>

    <SettingsSection
      v-if="requiresApiKey"
      :title="settingsMessage('settings.webSearch.apiKey.label')"
    >
      <SettingsRow
        :label="settingsMessage('settings.webSearch.apiKey.label')"
        :hint="hasStoredKeyForCurrentEngine
          ? settingsMessage('settings.webSearch.apiKey.savedDescription')
          : undefined"
      >
        <SecretInput
          class="settings-text-control"
          v-model="byokKey"
          :placeholder="hasStoredKeyForCurrentEngine
            ? settingsMessage('settings.webSearch.apiKey.savedPlaceholder')
            : settingsMessage('settings.webSearch.apiKey.placeholder')"
        />
        <button
          v-if="apiKeyUrl"
          type="button"
          class="settings-external-link"
          @click="openApiKeyPage"
        >
          <LinkIcon class="settings-external-link-icon" />
          <span>{{ settingsMessage('settings.webSearch.apiKey.obtain') }}: {{ apiKeyDisplayUrl }}</span>
        </button>
      </SettingsRow>
    </SettingsSection>

    <SettingsSection
      v-if="engine === 'searxng'"
      :title="settingsMessage('settings.webSearch.searxng.title')"
    >
      <SettingsRow :label="settingsMessage('settings.webSearch.searxng.urlLabel')">
        <CustomTextInput
          class="settings-text-control"
          v-model="searxngBaseUrl"
          type="url"
          :placeholder="settingsMessage('settings.webSearch.searxng.urlPlaceholder')"
        />
      </SettingsRow>
    </SettingsSection>

    <SettingsActions
      :secondary-text="testing
        ? settingsMessage('settings.webSearch.actions.testing')
        : settingsMessage('settings.webSearch.actions.test')"
      :primary-text="saving
        ? settingsMessage('settings.webSearch.actions.saving')
        : settingsMessage('settings.webSearch.actions.save')"
      :busy="loading || saving || testing"
      @secondary="testConnection"
      @primary="save"
    />
    <SettingsFeedback
      :kind="feedbackKind"
      :message="validationMessage || feedbackMessage"
    />

    <WebReadSettingsSection />
  </SettingsPage>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { CustomTextInput, SecretInput } from '@linnya/renderer-ui';
import { LinkIcon } from '@linnya/renderer-ui/icons';
import { openExternalUrl } from '@/shared/utils/openExternalUrl';
import type { SettingsChoiceOption, SettingsFeedbackKind } from '../../definitions/settingsKit';
import { WEB_SEARCH_ENGINE_PRESENTATIONS } from '../../definitions/webSearchSettings';
import { useWebSearchSettings } from '../../orchestration/useWebSearchSettings';
import {
  SettingsActions,
  SettingsChoiceGroup,
  SettingsFeedback,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '../kit';
import WebReadSettingsSection from '../sections/WebReadSettingsSection.vue';
import { useSettingsLocalization } from '../useSettingsLocalization';

const { settingsMessage } = useSettingsLocalization();
const {
  engine,
  byokKey,
  searxngBaseUrl,
  loading,
  saving,
  testing,
  feedback,
  validationError,
  requiresApiKey,
  hasStoredKeyForCurrentEngine,
  load,
  selectEngine,
  save,
  testConnection,
} = useWebSearchSettings();

const engineOptions = computed<readonly SettingsChoiceOption[]>(() => (
  WEB_SEARCH_ENGINE_PRESENTATIONS.map((option) => ({
    value: option.id,
    label: settingsMessage(option.nameKey),
    description: settingsMessage(option.descriptionKey),
    badge: option.experimental
      ? settingsMessage('settings.webSearch.engine.experimental')
      : undefined,
  }))
));

const apiKeyUrl = computed(() =>
  WEB_SEARCH_ENGINE_PRESENTATIONS.find((candidate) => candidate.id === engine.value)?.apiKeyUrl ?? '');
const apiKeyDisplayUrl = computed(() => apiKeyUrl.value.replace(/^https?:\/\//u, '').replace(/\/$/u, ''));

function openApiKeyPage(): void {
  if (apiKeyUrl.value) void openExternalUrl(apiKeyUrl.value);
}

function selectEngineValue(value: string): void {
  const option = WEB_SEARCH_ENGINE_PRESENTATIONS.find((candidate) => candidate.id === value);
  if (option) selectEngine(option.id);
}

const validationMessage = computed(() => {
  if (validationError.value === 'missing_byok_key') {
    return settingsMessage('settings.webSearch.validation.apiKeyRequired');
  }
  if (validationError.value === 'missing_searxng_url') {
    return settingsMessage('settings.webSearch.validation.searxngUrlRequired');
  }
  return '';
});

const feedbackMessage = computed(() => {
  if (!feedback.value) return '';
  if (feedback.value.kind === 'error') return feedback.value.message;
  if (feedback.value.code === 'saved') return settingsMessage('settings.webSearch.status.saved');
  return settingsMessage('settings.webSearch.status.connectionOk', { tookMs: feedback.value.tookMs });
});

const feedbackKind = computed<SettingsFeedbackKind>(() => {
  if (validationMessage.value) return 'error';
  return feedback.value?.kind === 'success' ? 'success' : 'error';
});

onMounted(() => {
  void load();
});
</script>
