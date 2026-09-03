<template>
  <div
    v-if="!tableAiModeStore.isActive"
    class="table-toolbar-root"
  >
    <!-- AI 功能组（使用原有的 AiToolbarSection，带高亮按钮） -->
    <AiToolbarSection @action="handleAIActionFromSection" />

    <!-- 插入操作组：下拉菜单 -->
    <ToolbarGroup>
      <ToolbarDropdown
        v-model:is-open="insertDropdownOpen"
        :options="insertOptions"
        :title="editorMessage('editor.tableBlock.toolbar.insertTitle')"
        button-class="toolbar-button"
        @select="handleInsertAction"
      >
        <template #trigger>
          {{ editorMessage('editor.tableBlock.toolbar.insert') }}
        </template>
      </ToolbarDropdown>
    </ToolbarGroup>

    <!-- 删除操作组：两个按钮 -->
    <ToolbarGroup>
      <ToolbarButton
        :title="editorMessage('editor.tableBlock.toolbar.deleteRow')"
        @click="deleteRowCommand"
      >
        {{ editorMessage('editor.tableBlock.toolbar.deleteRow') }}
      </ToolbarButton>
      <ToolbarButton
        :title="editorMessage('editor.tableBlock.toolbar.deleteColumn')"
        @click="deleteColumnCommand"
      >
        {{ editorMessage('editor.tableBlock.toolbar.deleteColumn') }}
      </ToolbarButton>
    </ToolbarGroup>

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
import { addRowBefore, addRowAfter, addColumnBefore, addColumnAfter } from '../commands/tableToolbarCommands';
import { deleteRow, deleteColumn } from '../commands/tableDeleteCommands';
import { mergeCells, splitCell } from '../commands/tableCellCommands';
import { alignCellLeft, alignCellCenter, alignCellRight } from '../commands/tableAlignCommands';
import { useTableAiInteraction } from '../ui/composables/useTableAiInteraction';
import { floatingToolbarService } from '../../../features/floating-toolbar/service';
import AiToolbarSection from '../ui/FloatingToolbar/AiToolbarSection.vue';
import ToolbarGroup from '../ui/FloatingToolbar/ToolbarGroup.vue';
import ToolbarButton from '../ui/FloatingToolbar/ToolbarButton.vue';
import ToolbarDropdown from '../ui/FloatingToolbar/ToolbarDropdown.vue';
import { useTableAiModeStore } from '../../../features/table-ai-mode';
import { useEditorLocalization } from '../../../ui/useEditorLocalization';
import {
  buildTableBlockAlignOptions,
  buildTableBlockInsertOptions,
} from '../functions/tableBlockPresentation';
import {
  collapseSelectionToTopLeftCell,
  executeTableToolbarCommand,
  type TableToolbarCommand,
} from './tableToolbarSelection';

const props = defineProps<{
  editor: Editor | null;
}>();

const tableAiModeStore = useTableAiModeStore();
const { editorMessage } = useEditorLocalization();
const insertOptions = computed(() => buildTableBlockInsertOptions(editorMessage));
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

const insertDropdownOpen = ref(false);
const alignDropdownOpen = ref(false);

const executeTableCommand = (commandFn: TableToolbarCommand): boolean => {
  return executeTableToolbarCommand(props.editor, commandFn);
};

// 在选区“第一行上方”插入行：如果是多行选区，则显式将选区收缩到左上角单元格，再调用 addRowBefore
const addRowBeforeCommand = () =>
  executeTableCommand((editorInstance) => {
    try {
      collapseSelectionToTopLeftCell(editorInstance);
    } catch (error) {
      console.warn('[TableSimpleToolbar] addRowBeforeCommand: 调整选区到左上角单元格失败，回退为默认行为。', error);
    }

    return addRowBefore(editorInstance);
  });

const addRowAfterCommand = () => executeTableCommand(addRowAfter);
const addColumnAfterCommand = () => executeTableCommand(addColumnAfter);
const addColumnBeforeCommand = () => executeTableCommand(addColumnBefore);
const deleteRowCommand = () => executeTableCommand(deleteRow);
const deleteColumnCommand = () => executeTableCommand(deleteColumn);
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

const handleInsertAction = (value: string) => {
  switch (value) {
    case 'addRowBefore':
      addRowBeforeCommand();
      break;
    case 'addRowAfter':
      addRowAfterCommand();
      break;
    case 'addColumnBefore':
      addColumnBeforeCommand();
      break;
    case 'addColumnAfter':
      addColumnAfterCommand();
      break;
  }
  insertDropdownOpen.value = false;
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
