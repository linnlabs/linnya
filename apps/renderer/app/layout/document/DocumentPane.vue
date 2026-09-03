<template>
  <section class="document-pane" :class="`document-pane--${layoutState.layoutMode}`">
    <div
      v-if="activeDocument?.type === 'editor' && editorDocumentSettings.menuBarVisible"
      class="document-pane__editor-tools"
    >
      <MenuBar />
    </div>

    <div class="document-pane__body">
      <OutlineSidebar v-if="activeDocument?.type === 'editor'" />
      <OutlineToggleButton v-if="activeDocument?.type === 'editor'" />
      <DocumentSurface />
      <CharacterCount
        v-if="activeDocument?.type === 'editor' && editorDocumentSettings.characterCountVisible"
        class="document-pane__character-count"
        :count="editorDocumentSettings.characterCount"
        @width-change="editorDocumentSettings.setCharacterCountActualWidth"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useLayoutStore } from '@/app/layout/store/layoutStore';
import { useEditorDocumentSettingsStore } from '@/domains/editor/features/DocumentSettings';
import MenuBar from '@/domains/editor/ui/MenuBar.vue';
import OutlineSidebar from '@/domains/editor/features/outline/OutlineSidebar.vue';
import OutlineToggleButton from '@/domains/editor/features/outline/OutlineToggleButton.vue';
import { CharacterCount } from '@linnya/renderer-ui';
import DocumentSurface from './DocumentSurface.vue';

const layoutStore = useLayoutStore();
const editorDocumentSettings = useEditorDocumentSettingsStore();

const layoutState = computed(() => layoutStore.state);
const activeDocument = computed(() => layoutState.value.activeDocument);
</script>
