<template>
  <div
    v-if="!tableAiModeStore.isActive"
    class="table-toolbar-root"
  >
    <!-- AI 功能组（使用原有的 AiToolbarSection，带高亮按钮） -->
    <AiToolbarSection @action="handleAIActionFromSection" />

    <!-- 插入、删除行列移到行列柄与菜单（见 TableStructureChrome）；工具条只保留对多格选区有意义的动作。 -->
    <!-- 对齐操作组：下拉菜单 -->
    <ToolbarGroup>
      <ToolbarDropdown
        v-model:is-open="alignDropdownOpen"
        :options="alignOptions"
        :title="editorMessage('editor.tableBlock.toolbar.alignTitle')"
        button-class="toolbar-button"
        @select="handleAlignAction"
      >
        <template #trigger>
          {{ editorMessage('editor.tableBlock.toolbar.align') }}
        </template>
      </ToolbarDropdown>
    </ToolbarGroup>

    <!-- 合并 / 拆分操作组 -->
    <ToolbarGroup>
      <ToolbarButton
        :title="editorMessage('editor.tableBlock.toolbar.mergeCellsTitle')"
        @click="mergeCellsCommand"
      >
        {{ editorMessage('editor.tableBlock.toolbar.merge') }}
      </ToolbarButton>
      <ToolbarButton
        :title="editorMessage('editor.tableBlock.toolbar.splitCellTitle')"
        @click="splitCellCommand"
      >
        {{ editorMessage('editor.tableBlock.toolbar.split') }}
      </ToolbarButton>
    </ToolbarGroup>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Editor } from '@tiptap/core';
import { mergeCells, splitCell } from '../commands/tableCellCommands';
import { alignCellLeft, alignCellCenter, alignCellRight } from '../commands/tableAlignCommands';
import { useTableAiInteraction } from '../ui/composables/useTableAiInteraction';
import { floatingToolbarService } from '../../../features/floating-toolbar/service';
import AiToolbarSection from '../ui/FloatingToolbar/AiToolbarSection.vue';
import { ToolbarGroup } from '@linnya/renderer-ui';
import ToolbarButton from '../ui/FloatingToolbar/ToolbarButton.vue';
import ToolbarDropdown from '../ui/FloatingToolbar/ToolbarDropdown.vue';
import { useTableAiModeStore } from '../../../features/table-ai-mode';
import { useEditorLocalization } from '../../../ui/useEditorLocalization';
import { buildTableBlockAlignOptions } from '../functions/tableBlockPresentation';
import {
  executeTableToolbarCommand,
  type TableToolbarCommand,
} from './tableToolbarSelection';

const props = defineProps<{
  editor: Editor | null;
}>();

const tableAiModeStore = useTableAiModeStore();
const { editorMessage } = useEditorLocalization();
const alignOptions = computed(() => buildTableBlockAlignOptions(editorMessage));
// 监听 AI 模式状态，一旦进入 AI 模式则关闭工具栏
watch(() => tableAiModeStore.isActive, (isTableMode) => {
  if (isTableMode) {
    floatingToolbarService.close();
  }
}, { immediate: true });

// 为 useTableAiInteraction 构造一个与原 TableFloatingToolbar 类似的 mergedEditorProps
const mergedEditorProps = computed(() => ({
  editor: props.editor,
  showToolbar: true,
  position: { top: 0, left: 0 },
  // 这些字段在 AI 交互中主要用于命令执行状态和隐藏工具栏，这里给出安全的默认实现
  setCommandExecuting: () => {},
  requestHideToolbar: () => {
    floatingToolbarService.close();
  },
}));

// 复用表格 AI 交互逻辑（包括启用侧边栏表格模式等）
const { handleAIAction } = useTableAiInteraction({
  mergedEditorProps,
  hideToolbar: () => {
    floatingToolbarService.close();
  },
});

const alignDropdownOpen = ref(false);

const executeTableCommand = (commandFn: TableToolbarCommand): boolean => {
  return executeTableToolbarCommand(props.editor, commandFn);
};

const mergeCellsCommand = () => executeTableCommand(mergeCells);
const splitCellCommand = () => executeTableCommand(splitCell);

const alignLeftCommand = () => executeTableCommand(alignCellLeft);
const alignCenterCommand = () => executeTableCommand(alignCellCenter);
const alignRightCommand = () => executeTableCommand(alignCellRight);

const handleAiFill = async () => {
  if (!props.editor) return;
  try {
    await handleAIAction('aiFill');
    // AI 模式启用后，悬浮工具栏可以适当延迟关闭，避免闪烁
    globalThis.setTimeout(() => floatingToolbarService.close(), 100);
  } catch (error: unknown) {
    console.error('[TableSimpleToolbar] 启用表格AI填充失败:', error);
    // 这里不使用 alert，避免打断用户；可以后续改成统一的通知机制
  }
};

// 兼容 AiToolbarSection 的事件接口
const handleAIActionFromSection = (action: string) => {
  if (action === 'aiFill') {
    handleAiFill();
  } else {
    handleAIAction(action);
  }
};

const handleAlignAction = (value: string) => {
  switch (value) {
    case 'alignLeft':
      alignLeftCommand();
      break;
    case 'alignCenter':
      alignCenterCommand();
      break;
    case 'alignRight':
      alignRightCommand();
      break;
  }
  alignDropdownOpen.value = false;
};
</script>
