<template>
  <section class="document-pane" :class="`document-pane--${layoutState.layoutMode}`">
    <div class="document-pane__body" :class="{ 'document-pane__body--with-command-bar': showCommandBar }">
      <EditorCommandBar v-if="showCommandBar" class="document-pane__command-bar" />
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
import EditorCommandBar from '@/domains/editor/ui/EditorCommandBar.vue';
import OutlineSidebar from '@/domains/editor/features/outline/OutlineSidebar.vue';
import OutlineToggleButton from '@/domains/editor/features/outline/OutlineToggleButton.vue';
import { CharacterCount } from '@linnya/renderer-ui';
import DocumentSurface from './DocumentSurface.vue';

const layoutStore = useLayoutStore();
const editorDocumentSettings = useEditorDocumentSettingsStore();

const layoutState = computed(() => layoutStore.state);
const activeDocument = computed(() => layoutState.value.activeDocument);
/** Markdown 文档的命令条悬浮在正文顶部居中，不占一整行；设置里可关闭。 */
const showCommandBar = computed(
  () => activeDocument.value?.type === 'editor' && editorDocumentSettings.menuBarVisible,
);
</script>
