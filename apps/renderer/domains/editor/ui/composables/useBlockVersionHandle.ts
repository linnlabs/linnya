/**
 * useBlockVersionHandle.ts
 *
 * 版本按钮状态逻辑
 * 
 * 职责：
 * - 判断当前块是否有历史版本
 * - 获取版本数量和最新版本号
 * - 处理版本按钮点击事件（打开/关闭历史视图）
 */

import { computed, watch, type ComputedRef, type Ref } from 'vue';
import { useBlockVersionHandleSummary } from '../../features/BlockHistory/readModel';
import { ensureBlockHistoryLoadedForRootBlockId } from '../../features/BlockHistory/orchestration/ensureBlockHistoryLoadedForRootBlockId';
import { toggleBlockHistoryForRootBlockId } from '../../features/BlockHistory/orchestration/toggleBlockHistoryForRootBlockId';
import { useFileStore } from '../../../../shared/stores/file';

// ==================== 类型定义 ====================

export interface UseBlockVersionHandleOptions {
  blockId: ComputedRef<string | null>;
  isBlockVisible?: Ref<boolean>;
}

export interface UseBlockVersionHandleReturn {
  /** 是否有历史版本 */
  hasHistory: ComputedRef<boolean>;
  /** 版本数量 */
  versionCount: ComputedRef<number>;
  /** 最新版本号 */
  latestVersionNumber: ComputedRef<number>;
  /** 处理版本按钮点击 */
  handleVersionClick: () => Promise<void>;
}

// ==================== Composable 实现 ====================

export function useBlockVersionHandle(options: UseBlockVersionHandleOptions): UseBlockVersionHandleReturn {
  const { blockId: sourceBlockId, isBlockVisible } = options;

  const fileStore = useFileStore();

  // ==================== 计算属性 ====================

  /** 当前块 ID */
  const blockId = computed<string>(() => sourceBlockId.value ?? '');

  /** 文档节点 ID */
  const documentNodeId = computed<string>(() => fileStore.currentFilePath || '');

  const versionSummary = useBlockVersionHandleSummary(blockId);

  /** 是否有历史版本 */
  const hasHistory = computed<boolean>(() => {
    return versionSummary.value.hasHistory;
  });

  /** 版本数量 */
  const versionCount = computed<number>(() => {
    return versionSummary.value.versionCount;
  });

  /** 最新版本号 */
  const latestVersionNumber = computed<number>(() => {
    return versionSummary.value.latestVersionNumber;
  });

  // ==================== 初始化：预加载历史版本元数据 ====================
  /**
   * 为了保证「有历史版本的块一打开文件就能看到版本按钮（在 hover 时出现）」，
   * 这里通过 watch 监听 documentNodeId / blockId，当它们就绪且当前块尚未加载过历史时，
   * 主动调用一次 loadBlockHistory。
   *
   * 说明：
   * - onMounted 时 fileStore.currentFilePath 可能尚未就绪，因此不能只在 mounted 钩子里判断；
   * - 使用 watch({ docId, id }, ...) 可以在文档 ID 后续变为有效时自动触发加载。
   */
  watch(
    () => ({
      docId: documentNodeId.value,
      id: blockId.value,
      isVisible: isBlockVisible?.value ?? true,
    }),
    async ({ docId, id, isVisible }) => {
      if (!docId || !id || !isVisible) {
        return;
      }

      const result = await ensureBlockHistoryLoadedForRootBlockId({
        documentNodeId: docId,
        blockId: id,
      });
      if (!result.ok) {
        console.error('[useBlockVersionHandle] 预加载历史版本失败:', result);
      }
    },
    { immediate: true }
  );

  // ==================== 方法 ====================

  /**
   * 处理版本按钮点击
   *
   * 行为：
   * - 如果当前块已经处于历史模式：退出历史模式（关闭视图）
   * - 如果当前块不在历史模式：
   *   1. 如果还没加载过版本列表，先加载
   *   2. 打开 Side-by-Side 历史视图
   *   3. 自动选中最新版本
   *
   * 也就是说：版本按钮 = 历史视图「开关」
   */
  const handleVersionClick = async (): Promise<void> => {
    const currentBlockId = blockId.value;
    const currentDocId = documentNodeId.value;

    if (!currentBlockId || !currentDocId) {
      console.warn('[useBlockVersionHandle] 缺少 blockId 或 documentNodeId');
      return;
    }

    try {
      const result = await toggleBlockHistoryForRootBlockId({
        documentNodeId: currentDocId,
        blockId: currentBlockId,
      });
      if (!result.ok) {
        console.error('[useBlockVersionHandle] 打开历史视图失败:', result);
      } else if (result.action === 'skipped') {
        console.log('[useBlockVersionHandle] 该块没有历史版本');
      }
    } catch (error) {
      console.error('[useBlockVersionHandle] 打开历史视图失败:', error);
    }
  };

  // ==================== 返回 ====================

  return {
    hasHistory,
    versionCount,
    latestVersionNumber,
    handleVersionClick,
  };
}

export default useBlockVersionHandle;
