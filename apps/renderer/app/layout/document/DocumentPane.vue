<template>
  <section class="document-pane" :class="`document-pane--${layoutState.layoutMode}`">
    <div class="document-pane__body" :style="bodyStyle">
      <div v-if="showCommandBar" ref="commandBarDock" class="document-pane__command-bar">
        <EditorCommandBar />
      </div>
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
import { computed, onBeforeUnmount, ref, watch } from 'vue';
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
/** Markdown 文档的命令条悬浮在正文底部居中，不占一整行；设置里可关闭。 */
const showCommandBar = computed(
  () => activeDocument.value?.type === 'editor' && editorDocumentSettings.menuBarVisible,
);

/**
 * 窗格底部是命令条与其它底部浮条（如修订工具条）共用的区域。命令条显示时把它的实际高度交给 CSS，
 * 由 DocumentPane.css 算出 `--document-pane-bottom-reserve`：其它底部浮条至少离底这么多，叠在命令条上方。
 * 量实际高度而不是写死数字，命令条的按钮尺寸来自 renderer-ui，这里不复制。
 */
const commandBarDock = ref<HTMLElement | null>(null);
const commandBarHeight = ref(0);
let commandBarObserver: ResizeObserver | null = null;

watch(commandBarDock, (element) => {
  commandBarObserver?.disconnect();
  commandBarObserver = null;
  commandBarHeight.value = 0;
  if (!element) return;
  commandBarObserver = new ResizeObserver(() => {
    commandBarHeight.value = element.offsetHeight;
  });
  commandBarObserver.observe(element);
});

onBeforeUnmount(() => commandBarObserver?.disconnect());

const bodyStyle = computed(() => ({
  '--document-pane-command-bar-height': `${commandBarHeight.value}px`,
}));
</script>
