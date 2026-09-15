<template>
  <SettingsSection
    :title="editorMessage('editor.documentSettings.ai.title')"
    :description="editorMessage('editor.documentSettings.ai.description')"
  >
    <SettingsSwitchRow
      v-model="isAutocompleteEnabled"
      :label="editorMessage('editor.documentSettings.ai.autocomplete')"
    />
    <SettingsSwitchRow
      v-model="isIntraParagraphCompletionEnabled"
      :label="editorMessage('editor.documentSettings.ai.intraParagraphCompletion')"
      :description="editorMessage('editor.documentSettings.ai.intraParagraphCompletionDescription')"
      :disabled="!isAutocompleteEnabled"
    />

    <SettingsRow
      control="fill"
      :label="editorMessage('editor.documentSettings.ai.triggerDelay')"
      :hint="editorMessage('editor.documentSettings.ai.triggerDelayDescription')"
    >
      <div class="editor-ai-range-control">
        <span class="editor-ai-range-value">{{ delayLabel }}</span>
        <div class="editor-ai-range-track">
          <CustomSlider
            v-model="delayLevel"
            :min="1"
            :max="5"
            :step="1"
            :disabled="!isAutocompleteEnabled"
            :aria-label="editorMessage('editor.documentSettings.ai.triggerDelay')"
          />
          <div class="editor-ai-range-labels">
            <span>{{ editorMessage('editor.documentSettings.ai.scale.slowest') }}</span>
            <span>{{ editorMessage('editor.documentSettings.ai.scale.fastest') }}</span>
          </div>
        </div>
      </div>
    </SettingsRow>

    <SettingsRow
      control="fill"
      :label="editorMessage('editor.documentSettings.ai.triggerFrequency')"
      :hint="editorMessage('editor.documentSettings.ai.triggerFrequencyDescription')"
    >
      <div class="editor-ai-range-control">
        <span class="editor-ai-range-value">{{ frequencyLabel }}</span>
        <div class="editor-ai-range-track">
          <CustomSlider
            v-model="frequencyLevel"
            :min="1"
            :max="6"
            :step="1"
            :disabled="!isAutocompleteEnabled"
            :aria-label="editorMessage('editor.documentSettings.ai.triggerFrequency')"
          />
          <div class="editor-ai-range-labels">
            <span>{{ editorMessage('editor.documentSettings.ai.scale.lowest') }}</span>
            <span>{{ editorMessage('editor.documentSettings.ai.scale.always') }}</span>
          </div>
        </div>
      </div>
    </SettingsRow>

    <SettingsRow
      control="fill"
      :label="editorMessage('editor.documentSettings.ai.completionLength')"
      :hint="editorMessage('editor.documentSettings.ai.completionLengthDescription')"
    >
      <div class="editor-ai-range-control">
        <span class="editor-ai-range-value">{{ completionLengthLabel }}</span>
        <div class="editor-ai-range-track">
          <CustomSlider
            v-model="completionLengthLevel"
            :min="1"
            :max="3"
            :step="1"
            :disabled="!isAutocompleteEnabled"
            :aria-label="editorMessage('editor.documentSettings.ai.completionLength')"
          />
          <div class="editor-ai-range-labels">
            <span>{{ editorMessage('editor.documentSettings.ai.scale.short') }}</span>
            <span>{{ editorMessage('editor.documentSettings.ai.scale.long') }}</span>
          </div>
        </div>
      </div>
    </SettingsRow>
  </SettingsSection>
</template>

<script setup>
import { computed } from 'vue';
import { CustomSlider } from '@linnya/renderer-ui';
import { useAiSettingsStore } from '@/shared/stores/aiSettings';
import {
  SettingsRow,
  SettingsSection,
  SettingsSwitchRow,
} from '@/domains/settings/public';
import { useEditorLocalization } from '../../../ui/useEditorLocalization';

const aiSettingsStore = useAiSettingsStore();
const { editorMessage } = useEditorLocalization();

const isAutocompleteEnabled = computed({
  get: () => aiSettingsStore.isAutocompleteEnabled,
  set: (value) => aiSettingsStore.updateAutocompleteEnabled(value),
});

const isIntraParagraphCompletionEnabled = computed({
  get: () => aiSettingsStore.isIntraParagraphCompletionEnabled,
  set: (value) => aiSettingsStore.updateIntraParagraphCompletionEnabled(value),
});

const delayLevel = computed({
  get: () => aiSettingsStore.delayLevel,
  set: (value) => aiSettingsStore.updateDelayLevel(value),
});
const delayLabel = computed(() => {
  switch (Number(delayLevel.value)) {
    case 1: return editorMessage('editor.documentSettings.ai.scale.slowest');
    case 2: return editorMessage('editor.documentSettings.ai.scale.slower');
    case 3: return editorMessage('editor.documentSettings.ai.scale.medium');
    case 4: return editorMessage('editor.documentSettings.ai.scale.faster');
    case 5: return editorMessage('editor.documentSettings.ai.scale.fastest');
    default: return editorMessage('editor.documentSettings.ai.scale.unknown');
  }
});

const frequencyLevel = computed({
  get: () => aiSettingsStore.frequencyLevel,
  set: (value) => aiSettingsStore.updateFrequencyLevel(value),
});
const frequencyLabel = computed(() => {
  switch (Number(frequencyLevel.value)) {
    case 1: return editorMessage('editor.documentSettings.ai.scale.lowest');
    case 2: return editorMessage('editor.documentSettings.ai.scale.lower');
    case 3: return editorMessage('editor.documentSettings.ai.scale.medium');
    case 4: return editorMessage('editor.documentSettings.ai.scale.higher');
    case 5: return editorMessage('editor.documentSettings.ai.scale.highest');
    case 6: return editorMessage('editor.documentSettings.ai.scale.always');
    default: return editorMessage('editor.documentSettings.ai.scale.unknown');
  }
});

const completionLengthLevel = computed({
  get: () => aiSettingsStore.completionLengthLevel,
  set: (value) => aiSettingsStore.updateCompletionLengthLevel(value),
});
const completionLengthLabel = computed(() => {
  switch (Number(completionLengthLevel.value)) {
    case 1: return editorMessage('editor.documentSettings.ai.scale.short');
    case 2: return editorMessage('editor.documentSettings.ai.scale.medium');
    case 3: return editorMessage('editor.documentSettings.ai.scale.long');
    default: return editorMessage('editor.documentSettings.ai.scale.medium');
  }
});
</script>
