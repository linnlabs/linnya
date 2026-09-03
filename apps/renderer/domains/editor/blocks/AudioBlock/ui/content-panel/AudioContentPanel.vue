<template>
  <div class="audio-content-panel" :class="{ 'is-collapsed': isCollapsed }">
    <!-- 分割线 -->
    <div class="panel-divider"></div>
    
    <div class="panel-header">
      <div class="tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          :class="['tab', { active: activeTab === tab.id }]"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>
      <button
        class="collapse-button"
        :title="isCollapsed
          ? editorMessage('editor.audioBlock.panel.expand')
          : editorMessage('editor.audioBlock.panel.collapse')"
        @click="toggleCollapse"
      >
        <ChevronIcon :direction="isCollapsed ? 'down' : 'up'" />
      </button>
    </div>

    <div v-if="!isCollapsed" class="panel-content">
      <NotesTab v-if="activeTab === 'notes'" :block-id="blockId" />
      <TranscriptTab v-if="activeTab === 'transcript'" :block-id="blockId" />
      <SummaryTab v-if="activeTab === 'summary'" :block-id="blockId" />
    </div>

    <div
      v-if="!isCollapsed && isResizable"
      class="resize-handle"
      @mousedown="startResize"
    ></div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useAudioRuntimeStore } from '../../store';
import NotesTab from './NotesTab.vue';
import TranscriptTab from './TranscriptTab.vue';
import SummaryTab from './SummaryTab.vue';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import { useEditorLocalization } from '../../../../ui/useEditorLocalization';
import { buildAudioBlockPanelTabs } from '../../functions/audioBlockPresentation';

const props = defineProps({
  blockId: { type: String, required: true },
  isRecordingMode: { type: Boolean, default: false }
});

const runtimeStore = useAudioRuntimeStore();
const { editorMessage } = useEditorLocalization();
const isCollapsed = ref(false);
const isResizable = ref(false); // 暂时禁用调整高度功能

// 根据录音状态决定显示哪些tabs
const tabs = computed(() => {
  return buildAudioBlockPanelTabs(props.isRecordingMode, editorMessage);
});

const activeTab = computed({
  get: () => runtimeStore.getRuntime(props.blockId).activeTab || 'notes',
  set: (value) => runtimeStore.updateRuntime(props.blockId, { activeTab: value })
});

const toggleCollapse = () => {
  isCollapsed.value = !isCollapsed.value;
};

const startResize = (event) => {
  // TODO: 实现拖拽调整高度功能
  event.preventDefault();
};
</script>
