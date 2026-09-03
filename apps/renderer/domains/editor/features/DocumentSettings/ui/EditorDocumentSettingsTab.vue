<template>
  <SettingsPage>
    <SettingsSection :title="editorMessage('editor.documentSettings.interface.title')">
      <SettingsSwitchRow
        :model-value="editorSettings.menuBarVisible"
        :label="editorMessage('editor.documentSettings.interface.menuBar')"
        :description="editorMessage('editor.documentSettings.interface.menuBarDescription')"
        @update:model-value="editorSettings.setMenuBarVisible"
      />
      <SettingsSwitchRow
        :model-value="editorSettings.characterCountVisible"
        :label="editorMessage('editor.documentSettings.interface.characterCount')"
        :description="characterCountDescription"
        @update:model-value="editorSettings.setCharacterCountVisible"
      />
      <SettingsSwitchRow
        :model-value="editorSettings.blockHoverEnabled"
        :label="editorMessage('editor.documentSettings.interface.blockHover')"
        :description="editorMessage('editor.documentSettings.interface.blockHoverDescription')"
        @update:model-value="editorSettings.setBlockHoverEnabled"
      />
    </SettingsSection>

    <SettingsSection :title="editorMessage('editor.documentSettings.input.title')">
      <SettingsSwitchRow
        :model-value="editorSettings.spellcheckEnabled"
        :label="editorMessage('editor.documentSettings.input.spellcheck')"
        :description="editorMessage('editor.documentSettings.input.spellcheckDescription')"
        @update:model-value="editorSettings.setSpellcheckEnabled"
      />
    </SettingsSection>

    <EditorAiInteractionSettingsSection />

    <SettingsSection :title="editorMessage('editor.documentSettings.model.title')">
      <AuxiliaryModelPurposeSelectGroup
        :purposes="documentAuxiliaryModelPurposes"
        id-prefix="editorDocumentAuxiliaryModelSelect"
      />
    </SettingsSection>
  </SettingsPage>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  AuxiliaryModelPurposeSelectGroup,
  DOCUMENT_AUXILIARY_MODEL_PURPOSES,
} from '@/domains/model-configuration';
import {
  SettingsPage,
  SettingsSection,
  SettingsSwitchRow,
} from '@/domains/settings/public';
import { useEditorDocumentSettingsStore } from '../store/editorDocumentSettingsStore';
import EditorAiInteractionSettingsSection from './EditorAiInteractionSettingsSection.vue';
import { useEditorLocalization } from '../../../ui/useEditorLocalization';

const editorSettings = useEditorDocumentSettingsStore();
const { editorMessage } = useEditorLocalization();
const documentAuxiliaryModelPurposes = DOCUMENT_AUXILIARY_MODEL_PURPOSES;

// 说明里带上实时字数，避免为了显示一个数字单开一行。
const characterCountDescription = computed(() => [
  editorMessage('editor.documentSettings.interface.characterCountDescription'),
  editorMessage('editor.documentSettings.interface.currentCharacterCount', {
    count: editorSettings.characterCount,
  }),
].join(' '));
</script>
