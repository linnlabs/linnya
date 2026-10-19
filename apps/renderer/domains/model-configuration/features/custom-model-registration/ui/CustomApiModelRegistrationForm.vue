<template>
  <div
    class="add-model-provider-form"
    data-registration-kind="custom-provider"
  >
    <SettingsRow
      :label="settingsMessage('settings.addModel.customProvider.label')"
      :hint="settingsMessage('settings.addModel.customProvider.description')"
    >
      <CustomTextInput
        :model-value="form.providerName"
        :disabled="status.isSubmitting"
        class="settings-text-control"
        :placeholder="settingsMessage('settings.addModel.customProvider.placeholder')"
        @update:model-value="session.setField('providerName', $event)"
      />
    </SettingsRow>

    <SettingsRow :label="settingsMessage('settings.addModel.apiUrl.label')">
      <CustomTextInput
        :model-value="form.baseUrl"
        :disabled="status.isSubmitting"
        class="settings-text-control"
        :placeholder="settingsMessage('settings.addModel.apiUrl.placeholder')"
        @update:model-value="session.setField('baseUrl', $event)"
      />
      <template #hint>
        {{ settingsMessage('settings.addModel.apiUrl.descriptionLine1') }}<br>
        {{ settingsMessage('settings.addModel.apiUrl.descriptionLine2') }}
      </template>
    </SettingsRow>

    <SettingsRow
      :label="settingsMessage('settings.addModel.apiKey.label')"
      :hint="settingsMessage('settings.addModel.apiKey.optionalReuseDescription')"
    >
      <SecretInput
        :model-value="form.credentialSecret"
        :disabled="status.isSubmitting"
        class="settings-text-control"
        :placeholder="settingsMessage('settings.addModel.apiKey.placeholder')"
        @update:model-value="session.setField('credentialSecret', $event)"
      />
    </SettingsRow>

    <SettingsRow
      :label="settingsMessage('settings.addModel.compatibility.label')"
      :hint="settingsMessage('settings.addModel.compatibility.description')"
    >
      <div class="settings-field-with-action add-model-select-with-action">
        <CustomSelect
          :model-value="form.customApiFormat"
          :disabled="status.isSubmitting"
          :options="customApiFormatOptions"
          :title="settingsMessage('settings.addModel.compatibility.selectTitle')"
          class="add-model-select-control flex-grow"
          font-size="14px"
          @update:model-value="
            session.setField('customApiFormat', CustomApiFormatSchema.parse($event))
          "
        />
        <BaseButton
          variant="secondary"
          size="md"
          class="add-model-discover-button"
          :disabled="isDiscovering || status.isSubmitting || !form.baseUrl"
          :title="settingsMessage('settings.addModel.discover.button')"
          @click="session.discover"
        >
          <template #icon><RefreshIcon class="add-model-refresh-icon" :class="{ 'is-spinning': isDiscovering }" /></template>
          <span>{{
            isDiscovering
              ? settingsMessage('settings.addModel.discover.fetching')
              : settingsMessage('settings.addModel.discover.button')
          }}</span>
        </BaseButton>
      </div>
      <SettingsFeedback
        v-if="discoveryFeedback"
        :kind="discoveryFeedback.kind"
        :message="discoveryFeedback.message"
      />
    </SettingsRow>

    <!-- 发现多个模型时，直接展示列表及启用/关闭开关 -->
    <div
      v-if="state.models.length > 0"
      class="custom-discovered-models-section"
    >
      <header class="custom-discovered-models-header">
        <span class="custom-discovered-models-title">
          {{
            settingsMessage('settings.addModel.discoveredModels.title').replace(
              '{count}',
              String(state.models.length)
            )
          }}
        </span>
        <button
          type="button"
          class="settings-link-button"
          :disabled="status.isSubmitting"
          @click="session.setAllEnabled(!allEnabled)"
        >
          {{
            allEnabled
              ? settingsMessage('settings.addModel.discoveredModels.disableAll')
              : settingsMessage('settings.addModel.discoveredModels.enableAll')
          }}
        </button>
      </header>

      <div class="custom-discovered-models-list">
        <SettingsList :bordered="false">
          <SettingsListRow
            v-for="row in state.models"
            :key="row.item.endpoint_model_id"
            :title="row.item.display_name"
            :meta="formatModelMeta(row.item)"
          >
            <template #trailing>
              <Switch
                :model-value="row.enabled"
                :disabled="status.isSubmitting"
                v-bind="{ ariaLabel: row.item.display_name }"
                @update:model-value="session.setModelEnabled(row.item.endpoint_model_id, $event)"
              />
            </template>
          </SettingsListRow>
        </SettingsList>
      </div>
    </div>

    <div class="add-model-submit">
      <BaseButton
        variant="tint"
        size="lg"
        block
        :disabled="
          status.isSubmitting || isDiscovering || status.success || state.models.length === 0
        "
        @click="session.submit"
      >
        {{ submitText }}
      </BaseButton>
      <SettingsFeedback
        kind="error"
        :message="status.error || ''"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue';
import { CustomApiFormatSchema, type CustomApiModelItem } from '@app/schemas';
import type { CustomSelectOption } from '@linnya/renderer-ui';
import { BaseButton, CustomSelect, CustomTextInput, SecretInput, Switch } from '@linnya/renderer-ui';
import { RefreshIcon } from '@linnya/renderer-ui/icons';
import {
  SettingsFeedback,
  SettingsList,
  SettingsListRow,
  SettingsRow,
  useSettingsLocalization,
} from '@/domains/settings/public';
import { CUSTOM_API_FORMAT_OPTIONS } from '../definitions/customApiFormatOption';
import { createCustomApiRegistrationSession } from '../orchestration/createCustomApiRegistrationSession';

const props = defineProps<{ readonly refreshModelCatalog: () => Promise<void> }>();
const { settingsMessage } = useSettingsLocalization();
const session = createCustomApiRegistrationSession(props.refreshModelCatalog, {
  invalidUrl: settingsMessage('settings.addModel.error.apiUrlInvalid'),
  discoveryEmpty: settingsMessage('settings.addModel.discover.empty'),
  discoveryFailed: settingsMessage('settings.addModel.discover.failed'),
  invalidConfiguration: settingsMessage('settings.addModel.error.invalidDiscoveredModels'),
  registrationFailed: settingsMessage('settings.addModel.error.unknown'),
  synchronizationFailed: settingsMessage('settings.addModel.savedSyncFailed'),
});
const { state } = session;
const form = computed(() => state.form);
const status = computed(() => state.status);
const isDiscovering = computed(() => state.isDiscovering);
const discoveryFeedback = computed(() => state.discoveryFeedback);
const allEnabled = computed(
  () => state.models.length > 0 && state.models.every(row => row.enabled)
);
const customApiFormatOptions = computed<CustomSelectOption[]>(() =>
  CUSTOM_API_FORMAT_OPTIONS.map(option => ({
    value: option.id,
    text: settingsMessage(option.labelKey),
  }))
);
const submitText = computed(() => {
  if (status.value.isSubmitting) return settingsMessage('settings.addModel.submit.adding');
  if (status.value.success) return settingsMessage('settings.addModel.submit.success');
  return settingsMessage('settings.addModel.submit.add');
});
function formatModelMeta(model: CustomApiModelItem): string {
  return [
    ...(model.endpoint_model_id !== model.display_name ? [model.endpoint_model_id] : []),
    `${Math.round(model.context_window_tokens / 1024)}k`,
    ...(model.supports_image_input ? [settingsMessage('settings.modelCapability.imageInput')] : []),
  ].join(' · ');
}
onBeforeUnmount(session.dispose);
</script>
