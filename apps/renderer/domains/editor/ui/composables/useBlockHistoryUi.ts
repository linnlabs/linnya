/**
 * useBlockHistoryUi.ts
 *
 * 历史模式 UI 状态与操作
 * - 历史模式状态（side-by-side / overlay / multi-column）
 * - 版本选择与标签
 * - 退出历史模式、恢复版本等操作
 */

import { computed, ref, type ComputedRef } from 'vue';
import {
  useBlockHistoryStore,
  type BlockHistoryUiState,
  type BlockHistoryStore,
} from '../../features/BlockHistory/store/useBlockHistoryStore';
import { useFileStore } from '../../../../shared/stores/file';
import type { BlockVersion } from '../../../../shared/ipc/blockHistoryGateway';
import {
  findSelectedBlockHistoryVersion,
  readCurrentBlockHistoryVersionLabel,
  readSelectedBlockHistoryVersionLabel,
  shouldPromptBeforeBlockHistoryRestore,
} from '../../features/BlockHistory/functions/readBlockHistoryPanelState';
import {
  restoreBlockHistoryVersionForRootBlock,
  type RestoreBlockHistoryVersionMode,
} from '../../features/BlockHistory/orchestration/restoreBlockHistoryVersionForRootBlock';
import { useEditorLocalization } from '../useEditorLocalization';

import type { Editor } from '@tiptap/vue-3';

// ==================== 类型定义 ====================

export interface BlockHistoryProps {
  editor: Editor;
  blockId: ComputedRef<string | null>;
  currentContentJson: ComputedRef<string | null>;
  getRootBlockPos: () => number | null;
}

export interface UseBlockHistoryUiOptions {
  props: BlockHistoryProps;
  enabled?: ComputedRef<boolean>;
}

export interface UseBlockHistoryUiReturn {
  /** 当前块 ID */
  currentBlockId: ComputedRef<string>;
  /** 当前块的历史 UI 状态 */
  historyUiState: ComputedRef<BlockHistoryUiState>;
  /** 是否处于历史模式（任意模式） */
  isInHistoryMode: ComputedRef<boolean>;
  /** 是否处于分栏对比模式 */
  isInSideBySideMode: ComputedRef<boolean>;
  /** 是否处于覆盖预览模式 */
  isInOverlayMode: ComputedRef<boolean>;
  /** 当前块内容对应的版本标签（左侧 header 文案） */
  currentVersionLabel: ComputedRef<string>;
  /** 选中的历史版本对象 */
  selectedHistoryVersion: ComputedRef<BlockVersion | null>;
  /** 历史版本标签（右侧 header 文案） */
  selectedVersionLabel: ComputedRef<string>;
  /** 获取当前块的内容 JSON */
  getCurrentBlockContent: ComputedRef<string | null>;
  /** 文档节点 ID */
  documentNodeId: ComputedRef<string>;
  /** 是否显示“未创建版本”的应用确认弹窗 */
  showUnsavedVersionDialog: ReturnType<typeof ref<boolean>>;
  /** 确认：先创建当前内容版本，再应用选中版本 */
  confirmRestoreWithSnapshot: () => Promise<void>;
  /** 仅应用选中版本，丢弃当前未入库的修改 */
  confirmRestoreDiscardChanges: () => Promise<void>;
  /** 关闭应用确认弹窗（不执行任何恢复） */
  cancelRestoreDialog: () => void;
  /** 退出历史模式 */
  handleExitHistoryMode: () => void;
  /** 选择历史版本 */
  handleVersionSelect: (versionId: string) => void;
  /** 恢复历史版本 */
  handleHistoryRestore: (versionId: string) => Promise<void>;
  /** 删除历史版本 */
  handleDeleteVersion: (versionId: string) => Promise<void>;
  /** 是否显示删除版本确认弹窗 */
  showDeleteVersionDialog: ReturnType<typeof ref<boolean>>;
  /** 确认删除历史版本 */
  confirmDeleteVersion: () => Promise<void>;
  /** 取消删除历史版本 */
  cancelDeleteVersion: () => void;
}

// ==================== Composable 实现 ====================

export function useBlockHistoryUi(options: UseBlockHistoryUiOptions): UseBlockHistoryUiReturn {
  const { props, enabled } = options;

  // ==================== Store 获取 ====================

  const blockHistoryStore: BlockHistoryStore = useBlockHistoryStore();
  const fileStore = useFileStore();
  const { currentLocale, editorMessage } = useEditorLocalization();

  // ==================== 计算属性 ====================

  /** 当前块 ID */
  const currentBlockId = computed<string>(() => props.blockId.value ?? '');

  /** 当前块的历史 UI 状态 */
  const historyUiState = computed<BlockHistoryUiState>(() => {
    return blockHistoryStore.getUiState(currentBlockId.value);
  });

  /** 是否处于历史模式 */
  const isInHistoryMode = computed<boolean>(() => {
    return blockHistoryStore.isInHistoryMode(currentBlockId.value);
  });

  const isHistoryUiEnabled = computed<boolean>(() => {
    return (enabled?.value ?? true) || isInHistoryMode.value;
  });

  /** 是否处于分栏对比模式 */
  const isInSideBySideMode = computed<boolean>(() => {
    return historyUiState.value.mode === 'side-by-side';
  });

  /** 是否处于覆盖预览模式 */
  const isInOverlayMode = computed<boolean>(() => {
    return historyUiState.value.mode === 'overlay';
  });

  /** 当前块的历史版本列表 */
  const versionsForCurrentBlock = computed<BlockVersion[]>(() => {
    if (!isHistoryUiEnabled.value) return [];
    return blockHistoryStore.getVersions(currentBlockId.value);
  });

  /** 当前版本标签（左侧 header 文案） */
  const currentVersionLabel = computed<string>(() => {
    return readCurrentBlockHistoryVersionLabel(
      getCurrentBlockContent.value,
      versionsForCurrentBlock.value,
      editorMessage,
    );
  });

  /** 选中的历史版本（用于 Side-by-Side 头部显示） */
  const selectedHistoryVersion = computed<BlockVersion | null>(() => {
    const uiState = blockHistoryStore.getUiState(currentBlockId.value);
    return findSelectedBlockHistoryVersion(versionsForCurrentBlock.value, uiState.selectedVersionId);
  });

  /** 历史版本标签（右侧 header 文案） */
  const selectedVersionLabel = computed<string>(() => {
    return readSelectedBlockHistoryVersionLabel(
      selectedHistoryVersion.value,
      editorMessage,
      currentLocale.value,
    );
  });

  /** 获取当前块的内容 JSON */
  const getCurrentBlockContent = computed<string | null>(() => {
    if (!isHistoryUiEnabled.value) return null;
    return props.currentContentJson.value;
  });

  /** 文档节点 ID */
  const documentNodeId = computed<string>(() => fileStore.currentFilePath || '');

  /** 是否显示“当前内容未创建版本”的确认对话框 */
  const showUnsavedVersionDialog = ref(false);
  /** 待恢复的历史版本 ID（由对话框确认后真正执行恢复） */
  const pendingRestoreVersionId = ref<string | null>(null);
  /** 是否显示删除版本确认弹窗 */
  const showDeleteVersionDialog = ref(false);
  /** 待删除的历史版本 ID（由对话框确认后真正执行删除） */
  const pendingDeleteVersionId = ref<string | null>(null);

  // ==================== 操作方法 ====================

  /**
   * 退出历史模式
   */
  const handleExitHistoryMode = (): void => {
    blockHistoryStore.exitHistoryMode(currentBlockId.value);
  };

  /**
   * 选择历史版本
   */
  const handleVersionSelect = (versionId: string): void => {
    void versionId;
    // 版本选择由 HistoryTimeline 等组件内部处理
  };

  async function restorePendingVersion(mode: RestoreBlockHistoryVersionMode): Promise<void> {
    const result = await restoreBlockHistoryVersionForRootBlock({
      editor: props.editor,
      documentNodeId: documentNodeId.value,
      blockId: currentBlockId.value,
      versionId: pendingRestoreVersionId.value,
      mode,
      currentContentJson: getCurrentBlockContent.value,
      getRootBlockPos: props.getRootBlockPos,
      store: blockHistoryStore,
    });

    if (!result.ok) {
      console.error('[useBlockHistoryUi] 恢复历史版本失败:', result);
    }

    pendingRestoreVersionId.value = null;
    showUnsavedVersionDialog.value = false;
  }

  /**
   * 恢复历史版本
   * 
   * 逻辑修正：
   * 仅将目标版本的内容“应用”到当前编辑器中，而不创建新的历史记录。
   * 避免出现“恢复 v8 后立即自动生成一个一模一样的 v9”的情况。
   */
  const handleHistoryRestore = async (versionId: string): Promise<void> => {
    if (shouldPromptBeforeBlockHistoryRestore({
      currentContentJson: getCurrentBlockContent.value,
      versions: versionsForCurrentBlock.value,
    })) {
      pendingRestoreVersionId.value = versionId;
      showUnsavedVersionDialog.value = true;
      return;
    }

    pendingRestoreVersionId.value = versionId;
    await restorePendingVersion('discard-current');
  };

  /**
   * 确认：先将当前内容保存为新版本，再应用选中版本
   */
  const confirmRestoreWithSnapshot = async (): Promise<void> => {
    await restorePendingVersion('create-current-snapshot');
  };

  /**
   * 确认：不保存当前内容，直接应用选中版本（当前改动将丢失）
   */
  const confirmRestoreDiscardChanges = async (): Promise<void> => {
    await restorePendingVersion('discard-current');
  };

  /**
   * 取消应用版本对话框（不执行恢复）
   */
  const cancelRestoreDialog = (): void => {
    pendingRestoreVersionId.value = null;
    showUnsavedVersionDialog.value = false;
  };

  /**
   * 删除历史版本
   */
  const handleDeleteVersion = async (versionId: string): Promise<void> => {
    try {
      const versions = versionsForCurrentBlock.value;
      const targetVersion = versions.find((version) => version.id === versionId);

      if (!targetVersion) {
        console.error('[useBlockHistoryUi] 删除版本失败：未找到目标版本', versionId);
        return;
      }

      pendingDeleteVersionId.value = versionId;
      showDeleteVersionDialog.value = true;
    } catch (error) {
      console.error('[useBlockHistoryUi] 预处理删除版本失败:', error);
    }
  };

  /**
   * 确认删除历史版本
   */
  const confirmDeleteVersion = async (): Promise<void> => {
    const versionId = pendingDeleteVersionId.value;

    if (!versionId) {
      showDeleteVersionDialog.value = false;
      return;
    }

    try {
      await blockHistoryStore.deleteVersion(versionId);
    } catch (error) {
      console.error('[useBlockHistoryUi] 删除历史版本时出现异常:', error);
    } finally {
      pendingDeleteVersionId.value = null;
      showDeleteVersionDialog.value = false;
    }
  };

  /**
   * 取消删除历史版本
   */
  const cancelDeleteVersion = (): void => {
    pendingDeleteVersionId.value = null;
    showDeleteVersionDialog.value = false;
  };

  return {
    currentBlockId,
    historyUiState,
    isInHistoryMode,
    isInSideBySideMode,
    isInOverlayMode,
    currentVersionLabel,
    selectedHistoryVersion,
    selectedVersionLabel,
    getCurrentBlockContent,
    documentNodeId,
    showUnsavedVersionDialog,
    confirmRestoreWithSnapshot,
    confirmRestoreDiscardChanges,
    cancelRestoreDialog,
    handleExitHistoryMode,
    handleVersionSelect,
    handleHistoryRestore,
    handleDeleteVersion,
    showDeleteVersionDialog,
    confirmDeleteVersion,
    cancelDeleteVersion,
  };
}
