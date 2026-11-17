<template>
  <div class="add-model-provider-form" data-registration-kind="custom-capability">
    <SettingsRow :label="settingsMessage('settings.addModel.compatibility.label')">
      <CustomSelect
        :model-value="form.apiFormat"
        :options="formatOptions"
        class="settings-text-control"
        :disabled="busy"
        @update:model-value="
          session.setField('apiFormat', CustomCapabilityApiFormatSchema.parse($event))
        "
      />
    </SettingsRow>
    <SettingsRow :label="settingsMessage('settings.addModel.capability.connectionName')">
      <CustomTextInput
        :model-value="form.providerName"
        :aria-label="settingsMessage('settings.addModel.capability.connectionName')"
        class="settings-text-control"
        :disabled="busy"
        :placeholder="settingsMessage('settings.addModel.customProvider.placeholder')"
        @update:model-value="session.setField('providerName', $event)"
      />
    </SettingsRow>
    <SettingsRow :label="settingsMessage('settings.addModel.apiUrl.label')" :hint="addressHint">
      <CustomTextInput
        :model-value="form.baseUrl"
        :aria-label="settingsMessage('settings.addModel.apiUrl.label')"
        class="settings-text-control"
        :disabled="busy"
        :placeholder="addressExample"
        @update:model-value="session.setField('baseUrl', $event)"
      />
    </SettingsRow>
    <SettingsRow :label="settingsMessage('settings.addModel.apiKey.label')">
      <SecretInput
        :model-value="form.credentialSecret"
        :aria-label="settingsMessage('settings.addModel.apiKey.label')"
        class="settings-text-control"
        :disabled="busy"
        :placeholder="settingsMessage('settings.addModel.apiKey.placeholder')"
        @update:model-value="session.setField('credentialSecret', $event)"
      />
    </SettingsRow>
    <SettingsRow
      :label="settingsMessage('settings.addModel.capability.modelId')"
      :hint="
        settingsMessage(
          form.apiFormat === 'paddle_layout_parsing'
            ? 'settings.addModel.capability.layoutModelIdHint'
            : 'settings.addModel.capability.modelIdHint'
        )
      "
    >
      <CustomTextInput
        :model-value="form.modelId"
        :aria-label="settingsMessage('settings.addModel.capability.modelId')"
        class="settings-text-control"
        :disabled="busy"
        placeholder="model-id"
        @update:model-value="session.setField('modelId', $event)"
      />
    </SettingsRow>
    <SettingsRow :label="settingsMessage('settings.modelDetails.displayName.label')">
      <CustomTextInput
        :model-value="form.displayName"
        :aria-label="settingsMessage('settings.modelDetails.displayName.label')"
        class="settings-text-control"
        :disabled="busy"
        :placeholder="settingsMessage('settings.addModel.capability.displayNamePlaceholder')"
        @update:model-value="session.setField('displayName', $event)"
      />
    </SettingsRow>
    <SettingsRow
      v-if="modelKind === 'document_ocr'"
      :label="settingsMessage('settings.addModel.capability.ocrMode')"
    >
      <CustomSelect
        :model-value="form.ocrMode"
        class="settings-text-control"
        :disabled="busy"
        :options="ocrModeOptions"
        @update:model-value="setOcrMode"
      />
    </SettingsRow>
    <SettingsRow
      v-if="modelKind === 'image_generation'"
      :label="settingsMessage('settings.addModel.capability.imageSizes')"
      :hint="settingsMessage('settings.addModel.capability.imageSizesHint')"
    >
      <CustomTextInput
        :model-value="form.imageSizes"
        :aria-label="settingsMessage('settings.addModel.capability.imageSizes')"
        class="settings-text-control"
        :disabled="busy"
        placeholder="1024x1024, 1536x1024"
        @update:model-value="session.setField('imageSizes', $event)"
      />
    </SettingsRow>
    <SettingsRow :hint="settingsMessage('settings.addModel.capability.testHint')">
      <BaseButton variant="secondary" :disabled="busy || state.saved" @click="session.test">
        {{
          state.busy === 'test'
            ? settingsMessage('settings.addModel.capability.testing')
            : settingsMessage('settings.addModel.capability.test')
        }}
      </BaseButton>
      <BaseButton v-if="state.busy === 'test'" variant="secondary" @click="session.cancelTest">
        {{ settingsMessage('settings.addModel.capability.cancelTest') }}
      </BaseButton>
      <span v-if="state.busy === 'test'">{{
        settingsMessage('settings.addModel.capability.cancelHint')
      }}</span>
    </SettingsRow>
    <div class="add-model-submit">
      <BaseButton
        variant="tint"
        size="lg"
        block
        :disabled="busy || state.saved"
        @click="session.submit"
      >
        {{
          state.saved
            ? settingsMessage('settings.addModel.submit.success')
            : settingsMessage('settings.addModel.submit.add')
        }}
      </BaseButton>
      <SettingsFeedback kind="error" :message="state.error" />
      <SettingsFeedback kind="success" :message="state.feedback" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';
import {
  CUSTOM_CAPABILITY_API_FORMATS,
  CustomCapabilityApiFormatSchema,
  type CustomCapabilityModelKind,
} from '@app/schemas/custom-api-onboarding';
import { BaseButton, CustomSelect, CustomTextInput, SecretInput } from '@linnya/renderer-ui';
import { SettingsRow, SettingsFeedback, useSettingsLocalization } from '@/domains/settings/public';
import { getCustomCapabilityAddressPresentation } from '../functions/getCustomCapabilityAddressPresentation';
import { createCustomCapabilityRegistrationSession } from '../orchestration/createCustomCapabilityRegistrationSession';

const props = defineProps<{
  readonly modelKind: CustomCapabilityModelKind;
  readonly refreshModelCatalog: () => Promise<void>;
}>();
const { settingsMessage } = useSettingsLocalization();
const session = createCustomCapabilityRegistrationSession(
  props.modelKind,
  props.refreshModelCatalog
);
const emit = defineEmits<{ busy: [value: boolean] }>();
const { state } = session;
watch(
  () => state.busy !== null,
  value => emit('busy', value),
  { immediate: true }
);
const form = computed(() => state.form);
const busy = computed(() => state.busy !== null);
const addressExample = computed(
  () => getCustomCapabilityAddressPresentation(form.value.apiFormat).example
);
const addressHint = computed(
  () => getCustomCapabilityAddressPresentation(form.value.apiFormat).hint
);
const formatOptions = CUSTOM_CAPABILITY_API_FORMATS.filter(
  item => item.kind === props.modelKind
).map(item => ({ value: item.id, text: item.label }));
const ocrModeOptions = computed(() => [
  {
    value: 'document_upload',
    text: settingsMessage('settings.addModel.capability.documentUpload'),
  },
  { value: 'page_image', text: settingsMessage('settings.addModel.capability.pageImage') },
]);
function setOcrMode(value: string | number) {
  if (value === 'document_upload' || value === 'page_image') session.setField('ocrMode', value);
}
onBeforeUnmount(session.dispose);
</script>
