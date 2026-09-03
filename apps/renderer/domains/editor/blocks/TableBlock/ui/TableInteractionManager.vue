<!-- src/renderer/features/TableBlock/ui/TableInteractionManager.vue -->
<!-- 表格交互管理器 - 统一管理表格的所有交互功能 -->
<template>
  <div class="table-interaction-manager-content">
    <!-- 表格单元格选中柄overlay -->
    <TableCellHandleOverlay
      :editor="editorValue"
      :active-cell-pos="activeCellPos"
      :show-handle="showHandle"
      @mousedown="onHandleClick"
    />

    <!-- 表格坐标轴（AI模式） -->
    <TableCoordinateHeaders
      :visible="showCoordinateHeaders && !!editorValue"
      :table-info="currentTableInfo || undefined"
      :editor="editorValue || undefined"
    />

    <!-- 未来可以在这里添加其他表格交互组件 -->
    <!-- 例如：拖拽选择框、多选指示器等 -->
  </div>
</template>

<script setup lang="ts">
import { computed, unref, ref, onMounted, onUnmounted, watch } from 'vue';
import type { Editor } from '@tiptap/core';
import type { Ref } from 'vue';
import { CellSelection } from '@tiptap/pm/tables';

import TableCellHandleOverlay from './TableCellHandleOverlay.vue';
import TableCoordinateHeaders from './TableCoordinateHeaders.vue';
import { TableCellInteractionPluginKey } from '../extensions/TableCellInteractionExtension.js';
import type { TableInfo } from './composables/types/tableAiTypes.js';
import { useTableRenderVirtualizationKeepAlive } from './composables/useTableRenderVirtualizationKeepAlive';
import { useTableAiModeStore } from '../../../features/table-ai-mode';
import {
  findTableIdentityAtPosition,
  findTableIdentityByRootBlockId,
} from '../position/tableIdentity';

interface Props {
  editor: Editor | Ref<Editor | null> | null;
  /**
   * 编辑器 id：用于多编辑器隔离。
   * 当前主编辑器固定为 'main'（参见 TableBlock integrations/setup.js 的默认值）。
   */
  editorId?: string;
}

const props = defineProps<Props>();
const editorId = computed(() => props.editorId ?? 'main');

const editorValue = computed(() => unref(props.editor));

// 1. 创建本地响应式状态，不再依赖 useTableState
const activeCellPos = ref<number | null>(null);
const showHandle = ref<boolean>(false);
const transactionVersion = ref(0);

// === Table AI 模式会话的 UI 投影 ===
const tableAiModeStore = useTableAiModeStore();

const showCoordinateHeaders = computed(() => {
  return tableAiModeStore.activeTable?.editorId === editorId.value;
});

const activeTablePos = computed<number | null>(() => {
  if (!showCoordinateHeaders.value) return null;
  return tableAiModeStore.activeTable?.lastKnownPos ?? null;
});

const activeTableRootBlockId = computed<string | null>(() => {
  if (!showCoordinateHeaders.value) return null;
  return tableAiModeStore.activeTable?.rootBlockId ?? null;
});

/**
 * 将模式会话的稳定表身份映射为 TableInfo，并始终从 editor.state 读取最新 table node。
 * 说明：node 快照不进入模式会话，避免长期持有过期 ProseMirrorNode。
 */
const currentTableInfo = computed<TableInfo | null>(() => {
  // editor.state 不是 Vue 响应式对象；显式读取版本号，让 transaction 后能重新定位 table。
  const shouldRefreshForTransaction = transactionVersion.value >= 0;
  if (!shouldRefreshForTransaction) return null;

  const editor = editorValue.value;
  const tablePos = activeTablePos.value;
  if (!editor || editor.isDestroyed) return null;

  const identity =
    findTableIdentityByRootBlockId(editor.state.doc, activeTableRootBlockId.value) ||
    (tablePos === null ? null : findTableIdentityAtPosition(editor.state.doc, tablePos));

  if (!identity) return null;

  return { node: identity.node, pos: identity.pos, rootBlockId: identity.rootBlockId };
});

/**
 * 表格浮层保活目标：
 * - AI 坐标轴依赖 table DOM 真实存在，用 tablePos 保活；
 * - 普通单元格 handle 依赖 cell DOM 真实存在，用 activeCellPos 保活。
 */
const activeTableInteractionPos = computed<number | null>(() => {
  if (currentTableInfo.value) return currentTableInfo.value.pos;
  if (showHandle.value && activeCellPos.value !== null) return activeCellPos.value;
  return null;
});

const activeTableInteractionBlockId = computed<string | null>(() => {
  return currentTableInfo.value?.rootBlockId ?? null;
});

useTableRenderVirtualizationKeepAlive({
  editor: editorValue,
  activePos: activeTableInteractionPos,
  activeBlockId: activeTableInteractionBlockId,
});

// +++ 新增：处理手柄点击事件 +++
const onHandleClick = (event: globalThis.MouseEvent) => {
  const editor = editorValue.value;
  const pos = activeCellPos.value;

  if (!editor || pos === null) {
    return;
  }

  // 阻止默认事件，例如文本选择或拖动
  event.preventDefault();
  event.stopPropagation();

  const { state, dispatch } = editor.view;
  const { tr } = state;

  try {
    // 解析单元格位置并创建 CellSelection
    const $cell = state.doc.resolve(pos);
    const selection = new CellSelection($cell);
    tr.setSelection(selection);

    dispatch(tr);

    // 点击后让编辑器重新获得焦点
    if (!editor.isFocused) {
      editor.view.focus();
    }

  } catch {
    // console.error("[TableInteractionManager] Error creating CellSelection on handle click:", error);
  }
};

// 2. 从 Prosemirror 插件同步状态到本地
const syncStateFromPlugin = () => {
  const editor = editorValue.value;
  if (!editor || editor.isDestroyed) {
    return;
  }

  transactionVersion.value += 1;

  // 直接从 JS 扩展的插件中获取状态
  const pluginState = TableCellInteractionPluginKey.getState(editor.state);

  if (pluginState) {
    activeCellPos.value = pluginState.activeCellPos;
    showHandle.value = pluginState.showHandle;
  }
};

/**
 * Table AI 模式互斥控制：当进入 table_fill 模式时，暂停 cell handle 插件；退出时恢复。
 * 说明：这是“模式机”设计的一部分，避免 Vue 层通过 v-if 强行移除组件导致状态割裂。
 */
const syncCellInteractionSuspended = (suspended: boolean) => {
  const editor = editorValue.value;
  if (!editor || editor.isDestroyed) return;
  const { state, view } = editor;
  view.dispatch(
    state.tr.setMeta(TableCellInteractionPluginKey, { suspended })
  );
};

// 4. 设置和清理编辑器事件监听器
onMounted(() => {
  const editor = editorValue.value;
  if (editor) {
    // 改为监听 transaction 事件，这是更底层的更新信号
    editor.on('transaction', syncStateFromPlugin);
    syncStateFromPlugin(); // 初始同步
  }
});

onUnmounted(() => {
  const editor = editorValue.value;
  if (editor && !editor.isDestroyed) {
    editor.off('transaction', syncStateFromPlugin);
  }
});

// 监听编辑器实例本身的变化，以防编辑器被重新创建
watch(editorValue, (newEditor, oldEditor) => {
  if (oldEditor && !oldEditor.isDestroyed) {
    oldEditor.off('transaction', syncStateFromPlugin);
  }
  if (newEditor) {
    newEditor.on('transaction', syncStateFromPlugin);
    syncStateFromPlugin();
  }
});

// 将业务模式 selector 单向投影为 PM 插件的技术互斥状态。
watch(
  () => showCoordinateHeaders.value,
  (enabled) => {
    // enabled=true => suspended=true（AI 模式互斥 handle）
    syncCellInteractionSuspended(enabled);
  },
  { immediate: true }
);

</script>
