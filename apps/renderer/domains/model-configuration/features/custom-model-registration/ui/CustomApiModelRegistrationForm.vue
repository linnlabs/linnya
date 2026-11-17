<template>
  <div class="custom-api-model-registration">
    <SettingsRow :label="settingsMessage('settings.addModel.modelKind.label')">
      <CustomSelect
        v-model="modelKind"
        :disabled="isBusy"
        :options="modelKindOptions"
        class="settings-text-control"
        :title="settingsMessage('settings.addModel.modelKind.label')"
      />
    </SettingsRow>
    <CustomLanguageModelRegistrationForm
      v-if="modelKind === 'chat'"
      :refresh-model-catalog="refreshModelCatalog"
      @busy="isBusy = $event"
    />
    <CustomCapabilityModelRegistrationForm
      v-else
      :key="modelKind"
      :model-kind="modelKind"
      :refresh-model-catalog="refreshModelCatalog"
      @busy="isBusy = $event"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { CustomSelect } from '@linnya/renderer-ui';
import { SettingsRow, useSettingsLocalization } from '@/domains/settings/public';
import CustomLanguageModelRegistrationForm from './CustomLanguageModelRegistrationForm.vue';
import CustomCapabilityModelRegistrationForm from './CustomCapabilityModelRegistrationForm.vue';

defineProps<{ readonly refreshModelCatalog: () => Promise<void> }>();
const { settingsMessage } = useSettingsLocalization();
const isBusy = ref(false);
const modelKind = ref<
  'chat' | import('@app/schemas/custom-api-onboarding').CustomCapabilityModelKind
>('chat');
const modelKindOptions = computed(() => [
  { value: 'chat', text: settingsMessage('settings.addModel.modelKind.chat') },
  { value: 'embedding', text: settingsMessage('settings.addModel.modelKind.embedding') },
  { value: 'rerank', text: settingsMessage('settings.addModel.modelKind.rerank') },
  { value: 'document_ocr', text: settingsMessage('settings.addModel.modelKind.documentOcr') },
  {
    value: 'image_generation',
    text: settingsMessage('settings.addModel.modelKind.imageGeneration'),
  },
]);
</script>
