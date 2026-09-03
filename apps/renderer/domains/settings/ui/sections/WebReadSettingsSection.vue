<template>
  <SettingsSection :title="settingsMessage('settings.webRead.render.title')">
    <SettingsSwitchRow
      :model-value="renderEnabled"
      :label="settingsMessage('settings.webRead.render.label')"
      :disabled="isBusy"
      @update:model-value="setRenderEnabled"
    />
  </SettingsSection>

  <SettingsSection :title="settingsMessage('settings.webRead.reader.title')">
    <template #actions>
      <Switch
        :model-value="managedEnabled"
        :ariaLabel="settingsMessage('settings.webRead.reader.title')"
        :disabled="isBusy"
        @update:model-value="setManagedEnabled"
      />
    </template>

    <SettingsChoiceGroup
      :model-value="managedReader"
      :options="readerOptions"
      name="web-read-reader"
      :disabled="!managedEnabled || isBusy"
      :busy="loading"
      @update:model-value="selectReaderValue"
    />
  </SettingsSection>

  <SettingsSection
    v-if="managedEnabled"
    :title="settingsMessage('settings.webRead.credential.title')"
  >
    <SettingsRow
      :label="settingsMessage('settings.webRead.apiKey.label')"
      :hint="credentialHint"
    >
      <SecretInput
        v-model="byokKey"
        :placeholder="credentialAvailableForCurrentReader
          ? settingsMessage('settings.webRead.apiKey.availablePlaceholder')
          : settingsMessage('settings.webRead.apiKey.placeholder')"
      />
      <button
        v-if="apiKeyUrl"
        type="button"
        class="settings-external-link"
        @click="openApiKeyPage"
      >
        <LinkIcon />
        <span>{{ settingsMessage('settings.webRead.apiKey.obtain') }}: {{ apiKeyDisplayUrl }}</span>
      </button>
    </SettingsRow>

    <SettingsActions
      :secondary-text="testing
        ? settingsMessage('settings.webRead.actions.testing')
        : settingsMessage('settings.webRead.actions.test')"
      :primary-text="saving
        ? settingsMessage('settings.webRead.actions.saving')
        : settingsMessage('settings.webRead.actions.save')"
      :busy="isBusy"
      @secondary="testConnection"
      @primary="save"
    />
    <SettingsFeedback
      :kind="feedbackKind"
      :message="validationMessage || feedbackMessage"
    />
  </SettingsSection>

  <SettingsFeedback
    v-else
    kind="error"
    :message="feedback?.kind === 'error' ? feedbackMessage : ''"
  />
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { LinkIcon } from '@linnya/renderer-ui/icons';
import { SecretInput, Switch } from '@linnya/renderer-ui';
import { openExternalUrl } from '@/shared/utils/openExternalUrl';
import type { SettingsChoiceOption, SettingsFeedbackKind } from '../../definitions/settingsKit';
import { WEB_READ_READER_PRESENTATIONS } from '../../definitions/webReadSettings';
import { useWebReadSettings } from '../../orchestration/useWebReadSettings';
import {
  SettingsActions,
  SettingsChoiceGroup,
  SettingsFeedback,
  SettingsRow,
  SettingsSection,
  SettingsSwitchRow,
} from '../kit';
import { useSettingsLocalization } from '../useSettingsLocalization';

const { settingsMessage } = useSettingsLocalization();
const {
  renderEnabled,
  managedReader,
  byokKey,
  loading,
  saving,
  testing,
  feedback,
  validationError,
  managedEnabled,
  hasStoredKeyForCurrentReader,
  credentialAvailableForCurrentReader,
  load,
  setRenderEnabled,
  setManagedEnabled,
  selectManagedReader,
  save,
  testConnection,
} = useWebReadSettings();

const isBusy = computed(() => loading.value || saving.value || testing.value);

const readerOptions = computed<readonly SettingsChoiceOption[]>(() => (
  WEB_READ_READER_PRESENTATIONS.map((option) => ({
    value: option.id,
    label: settingsMessage(option.nameKey),
    description: settingsMessage(option.descriptionKey),
  }))
));

const apiKeyUrl = computed(() =>
  WEB_READ_READER_PRESENTATIONS.find((candidate) => candidate.id === managedReader.value)?.apiKeyUrl ?? '');
const apiKeyDisplayUrl = computed(() => apiKeyUrl.value.replace(/^https?:\/\//u, '').replace(/\/$/u, ''));

const credentialHint = computed(() => {
  if (hasStoredKeyForCurrentReader.value) {
    return settingsMessage('settings.webRead.apiKey.savedDescription');
  }
  if (credentialAvailableForCurrentReader.value) {
    return settingsMessage('settings.webRead.apiKey.registryDescription');
  }
  return undefined;
});

function openApiKeyPage(): void {
  if (apiKeyUrl.value) void openExternalUrl(apiKeyUrl.value);
}

function selectReaderValue(value: string): void {
  const option = WEB_READ_READER_PRESENTATIONS.find((candidate) => candidate.id === value);
  if (option) selectManagedReader(option.id);
}

const validationMessage = computed(() => validationError.value === 'missing_byok_key'
  ? settingsMessage('settings.webRead.validation.apiKeyRequired')
  : '');

const feedbackMessage = computed(() => {
  if (!feedback.value) return '';
  if (feedback.value.kind === 'error') return feedback.value.message;
  if (feedback.value.code === 'saved') return settingsMessage('settings.webRead.status.saved');
  return settingsMessage('settings.webRead.status.connectionOk', { tookMs: feedback.value.tookMs });
});

const feedbackKind = computed<SettingsFeedbackKind>(() => {
  if (validationMessage.value) return 'error';
  return feedback.value?.kind === 'success' ? 'success' : 'error';
});

onMounted(() => {
  void load();
});
</script>
